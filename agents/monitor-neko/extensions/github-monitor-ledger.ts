import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type, type Static } from '@sinclair/typebox'

const DEFAULT_PRUNE_DAYS = 45
const MAX_ENTRIES = 5000
const LOCK_TIMEOUT_MS = 5000
const LOCK_RETRY_MS = 50

function stringOrNumberSchema(description: string) {
  return Type.Union([Type.String(), Type.Number()], { description })
}

const ledgerStateSchema = Type.Object(
  {
    repo: Type.Optional(
      Type.String({
        description:
          'GitHub repository in owner/name form. Used for context, not as a noisy digest input.',
      })
    ),
    pr: Type.Optional(stringOrNumberSchema('Pull request number when this event is PR-scoped.')),
    issue: Type.Optional(stringOrNumberSchema('Issue number when this event is issue-scoped.')),
    headSha: Type.Optional(
      Type.String({
        description: 'Current PR head sha. Short or full hex sha is accepted.',
      })
    ),
    state: Type.Optional(
      Type.String({
        description: 'GitHub lifecycle state such as OPEN, MERGED, or CLOSED.',
      })
    ),
    terminal: Type.Optional(
      Type.String({
        description: 'Terminal state when known, usually merged or closed.',
      })
    ),
    merged: Type.Optional(Type.Boolean({ description: 'Whether the PR has been merged.' })),
    closed: Type.Optional(
      Type.Boolean({ description: 'Whether the PR or issue has been closed.' })
    ),
    reviewDecision: Type.Optional(
      Type.String({
        description: 'Current PR review decision, such as REVIEW_REQUIRED or APPROVED.',
      })
    ),
    latestReviewId: Type.Optional(
      stringOrNumberSchema('Stable id for the latest actionable review.')
    ),
    latestCommentId: Type.Optional(
      stringOrNumberSchema('Stable id for the latest actionable human comment.')
    ),
    failedChecks: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Names of currently failed CI checks. Order does not matter.',
      })
    ),
    failureFingerprint: Type.Optional(
      Type.String({
        description:
          'Stable fingerprint of a validated actionable CI root cause. Exclude timestamps, run ids, log line numbers, and other volatile details.',
      })
    ),
    gate: Type.Optional(
      Type.String({
        description:
          'Optional explicit non-CI blocker classification, such as approval. The ledger never infers this from check names.',
      })
    ),
  },
  { additionalProperties: false }
)

const ledgerSourceEventSchema = Type.Object(
  {
    type: Type.String({
      description:
        'Exact GitHub source event type, such as issue_comment, pull_request_review, or review_requested.',
    }),
    id: stringOrNumberSchema('Stable GitHub id for the exact source event.'),
    url: Type.Optional(Type.String()),
    actorLogin: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    createdAt: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
    description:
      'Exact immutable GitHub event identity. When present, type + id determine both the ledger key and digest.',
  }
)

const ledgerEventSchema = Type.Object(
  {
    eventKey: Type.Optional(
      Type.String({
        description:
          'Canonical github:thread:<thread_id> key for synthetic state from the current unread notification. Omit for exact source events; sourceEvent type + id become the key.',
      })
    ),
    state: Type.Optional(ledgerStateSchema),
    stateDigest: Type.Optional(
      Type.String({
        description:
          'Legacy free-form digest of the current actionable state. Prefer state for new callers; this field remains supported and is normalized by the tool.',
      })
    ),
    sourceEvent: Type.Optional(ledgerSourceEventSchema),
    actorLogin: Type.Optional(
      Type.String({
        description: 'GitHub login that authored or triggered the event when known.',
      })
    ),
    requestedReviewerLogin: Type.Optional(
      Type.String({
        description:
          'GitHub login targeted by a review request. Stored only as event provenance; it does not establish authorization.',
      })
    ),
    outcome: Type.Optional(
      Type.Union([Type.Literal('routed'), Type.Literal('suppressed')], {
        description:
          'Handled outcome. Only used with action=record after you successfully routed or intentionally suppressed the event.',
      })
    ),
    targetSessionId: Type.Optional(
      Type.String({
        description: 'Session that received the routed message, when outcome=routed.',
      })
    ),
    messageKind: Type.Optional(
      Type.String({
        description: 'NNP message kind used when recording handling. Monitor routes use inform.',
      })
    ),
    intent: Type.Optional(
      Type.String({
        description: 'Intent used when recording handling.',
      })
    ),
  },
  { additionalProperties: false }
)

const githubMonitorLedgerSchema = Type.Object(
  {
    action: Type.Union([Type.Literal('check'), Type.Literal('record'), Type.Literal('stats')]),
    selfLogins: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'GitHub logins that should count as self-authored when matching actorLogin values.',
      })
    ),
    events: Type.Optional(
      Type.Array(ledgerEventSchema, {
        description: 'Events to check or record.',
      })
    ),
  },
  { additionalProperties: false }
)

type GithubMonitorLedgerInput = Static<typeof githubMonitorLedgerSchema>
type LedgerEventInput = Static<typeof ledgerEventSchema>
type LedgerStateInput = Static<typeof ledgerStateSchema>
type NormalizedLedgerEventInput = Omit<LedgerEventInput, 'eventKey' | 'stateDigest'> & {
  eventKey: string
  stateDigest: string
}
type LedgerOutcome = 'routed' | 'suppressed'
type SeenStatus = 'new' | 'seen_repeat' | 'seen_changed'
type HandledStatus = 'unhandled' | 'handled_repeat' | 'handled_changed'
type ExactEventKind = 'comment' | 'review' | 'review-comment' | 'review-request'

type ExactEventIdentity = {
  kind: ExactEventKind
  id: string
}

type LedgerEntry = {
  eventKey: string
  firstSeenAt: string
  lastSeenAt: string
  lastSeenDigest: string
  seenCount: number
  actorLogin: string | null
  requestedReviewerLogin: string | null
  isSelfAuthored: boolean
  lastHandledAt: string | null
  lastHandledDigest: string | null
  lastHandledOutcome: LedgerOutcome | null
  handledCount: number
  targetSessionId: string | null
  messageKind: string | null
  intent: string | null
}

type LedgerState = {
  version: 1
  projectId: string
  projectRoot: string
  updatedAt: string
  entries: Record<string, LedgerEntry>
}

type CheckResult = {
  eventKey: string
  stateDigest: string
  actorLogin: string | null
  requestedReviewerLogin: string | null
  isSelfAuthored: boolean
  seenStatus: SeenStatus
  handledStatus: HandledStatus
  shouldAct: boolean
  lastHandledOutcome: LedgerOutcome | null
  lastHandledAt: string | null
  seenCount: number
  handledCount: number
}

type RecordResult = {
  eventKey: string
  stateDigest: string
  outcome: LedgerOutcome
  requestedOutcome: LedgerOutcome
  handledStatus: HandledStatus
  actorLogin: string | null
  requestedReviewerLogin: string | null
  isSelfAuthored: boolean
  handledCount: number
  targetSessionId: string | null
  messageKind: string | null
  intent: string | null
}

function normalizeLogin(login: string | undefined): string | null {
  const trimmed = login?.trim()
  return trimmed ? trimmed.toLowerCase() : null
}

function buildLoginSet(logins: readonly string[] | undefined) {
  return new Set(
    (logins ?? [])
      .map((login) => normalizeLogin(login))
      .filter((login): login is string => login !== null)
  )
}

function normalizeExactEventKind(value: string): ExactEventKind | null {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/^github[.:/_-]+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (
    normalized === 'pull_request_review_comment' ||
    normalized === 'pull_review_comment' ||
    normalized === 'review_comment'
  ) {
    return 'review-comment'
  }
  if (
    normalized === 'review_requested' ||
    normalized === 'review_request' ||
    normalized === 'review_requested_event' ||
    normalized === 'graphql_review_requested_event' ||
    normalized === 'pull_request_review_request'
  ) {
    return 'review-request'
  }
  if (normalized === 'issue_comment' || normalized === 'comment') {
    return 'comment'
  }
  if (
    normalized === 'pull_request_review' ||
    normalized === 'pull_review' ||
    normalized === 'review'
  ) {
    return 'review'
  }
  return null
}

function normalizeExactEventId(value: string | number): string {
  const normalized = String(value).trim()
  if (!normalized) {
    throw new Error('github_monitor_ledger sourceEvent.id must be non-empty')
  }
  return normalized
}

function exactEventKey(identity: ExactEventIdentity): string {
  return `github:event:${identity.kind}:${identity.id}`
}

function exactEventDigest(identity: ExactEventIdentity): string {
  return `event=${identity.kind}:${identity.id}`
}

function parseCanonicalExactEventKey(eventKey: string): ExactEventIdentity | null {
  const match = /^github:event:([^:]+):(.+)$/i.exec(eventKey.trim())
  const kind = match?.[1] ? normalizeExactEventKind(match[1]) : null
  const id = match?.[2]?.trim()
  return kind && id ? { kind, id } : null
}

function parseExactEventDigest(stateDigest: string): ExactEventIdentity | null {
  const components = parseDigestComponents(stateDigest)
  const value = components
    ?.find((component) => component.key.toLowerCase() === 'event')
    ?.value.trim()
  if (!value) {
    return null
  }
  const separator = value.indexOf(':')
  if (separator <= 0) {
    return null
  }
  const kind = normalizeExactEventKind(value.slice(0, separator))
  const id = value.slice(separator + 1).trim()
  return kind && id ? { kind, id } : null
}

function legacyExactEventKind(eventKey: string): ExactEventKind | null {
  const normalized = eventKey
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')

  if (
    normalized.includes('session_pr') ||
    normalized.includes('thread') ||
    normalized.includes('notification')
  ) {
    return null
  }
  if (
    normalized.includes('pull_request_review_comment') ||
    normalized.includes('pull_review_comment') ||
    normalized.includes('review_comment')
  ) {
    return 'review-comment'
  }
  if (normalized.includes('issue_comment') || /(?:^|_)comment(?:_|$)/.test(normalized)) {
    return 'comment'
  }
  if (
    normalized.includes('pull_request_review') ||
    normalized.includes('pull_review') ||
    /(?:^|_)review(?:_|$)/.test(normalized)
  ) {
    return 'review'
  }
  return null
}

function inferLegacyExactEvent(eventKey: string, stateDigest: string): ExactEventIdentity | null {
  const canonical = parseCanonicalExactEventKey(eventKey) ?? parseExactEventDigest(stateDigest)
  if (canonical) {
    return canonical
  }

  const kind = legacyExactEventKind(eventKey)
  if (!kind) {
    return null
  }
  const components = parseDigestComponents(stateDigest)
  if (!components) {
    return null
  }
  const digestKey = kind === 'review' ? 'latest_review' : 'comment'
  const id = digestComponentValue(components, digestKey)
  if (!id || !eventKey.toLowerCase().includes(id.toLowerCase())) {
    return null
  }
  return { kind, id }
}

const LEGACY_COMPOSITE_EVENT_COMPONENTS = [
  {
    kind: 'review-request',
    keys: [
      'latest_review_request',
      'latestReviewRequest',
      'latest_review_request_id',
      'latestReviewRequestId',
      'review_request',
      'reviewRequest',
      'review_request_id',
      'reviewRequestId',
    ],
  },
  {
    kind: 'comment',
    keys: ['latest_comment', 'latestComment', 'comment_id', 'commentId', 'comment'],
  },
  {
    kind: 'review',
    keys: ['latest_review', 'latestReview', 'review_id', 'reviewId'],
  },
] as const satisfies readonly {
  kind: ExactEventKind
  keys: readonly string[]
}[]

function legacyCompositeExactEvents(stateDigest: string | null): ExactEventIdentity[] {
  if (!stateDigest) {
    return []
  }
  return LEGACY_COMPOSITE_EVENT_COMPONENTS.flatMap(({ kind, keys }) => {
    const id = extractActionValue(compactDigest(stateDigest), keys)
    return id ? [{ kind, id }] : []
  })
}

function canonicalizeEventKey(eventKey: string): string {
  const trimmed = eventKey.trim()
  const threadMatch =
    /^(?:github:thread|github-thread|gh:thread|gh-thread|github:notification|github-notification|github_notification|gh:notification|gh-notification|notification|thread)[\s:#_-]*(\d+)(?:\b.*)?$/i.exec(
      trimmed
    )
  return threadMatch ? `github:thread:${threadMatch[1]}` : trimmed
}

function compactDigest(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function extractDigestValue(digest: string, keys: readonly string[]): string | null {
  for (const key of keys) {
    const match = new RegExp(`(?:^|[;|,\\n])\\s*${key}\\s*[:=]\\s*([^;|,\\n]+)`, 'i').exec(digest)
    const value = match?.[1]?.trim()
    if (value) {
      return value
    }
  }
  return null
}

function extractDigestBool(digest: string, keys: readonly string[]): boolean | null {
  const value = extractDigestValue(digest, keys)?.toLowerCase()
  if (value === 'true' || value === 'yes' || value === '1') {
    return true
  }
  if (value === 'false' || value === 'no' || value === '0') {
    return false
  }
  return null
}

function extractDigestSha(digest: string, keys: readonly string[]): string | null {
  for (const key of keys) {
    const match = new RegExp(`\\b${key}\\s*[:=]\\s*([0-9a-f]{7,40})\\b`, 'i').exec(digest)
    if (match?.[1]) {
      return match[1].toLowerCase()
    }
  }
  return null
}

function normalizeDigestToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeCheckName(value: string): string {
  let normalized = normalizeDigestToken(value)
  if (/^[^/]+\/[^/]+$/.test(normalized) && !normalized.includes(' / ')) {
    normalized = normalized.split('/').at(-1) ?? normalized
  }
  return normalized
}

function normalizeCheckNames(values: readonly string[] | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((item) => normalizeCheckName(item)).filter(Boolean))
  ).sort()
}

function extractFailedChecks(digest: string): string[] {
  const explicitMatch =
    /(?:^|[;\n])\s*(?:failed(?:_checks)?|ci_failed|checks|failures?)\s*[:=]\s*([^;\n]+)/i.exec(
      digest
    )
  const ciMatch = /\bci\s*[:=]\s*failed(?::([^;|,\n]+))?/i.exec(digest)
  const raw = explicitMatch?.[1] ?? ciMatch?.[1] ?? ''
  return normalizeCheckNames(raw.split(/[|,]/))
}

function extractActionValue(digest: string, keys: readonly string[]): string | null {
  for (const key of keys) {
    const match = new RegExp(`(?:^|[;|,\\n])\\s*${key}\\s*[:=]\\s*([^;|,\\n]+)`, 'i').exec(digest)
    const value = match?.[1]?.trim()
    if (value) {
      return normalizeDigestToken(value)
    }
  }
  return null
}

function canonicalizeStateDigest(stateDigest: string): string {
  const compact = compactDigest(stateDigest)
  if (!compact) {
    return compact
  }

  const head = extractDigestSha(compact, ['head', 'head_sha', 'headRefOid', 'headRef', 'sha'])
  const terminal = extractDigestValue(compact, ['terminal'])?.toLowerCase()
  const state = extractDigestValue(compact, ['state'])?.toLowerCase()
  const merged = extractDigestBool(compact, ['merged'])
  const closed = extractDigestBool(compact, ['closed'])
  const review = extractDigestValue(compact, ['reviewDecision', 'review'])?.toLowerCase()
  const gate = extractDigestValue(compact, ['gate'])?.toLowerCase()
  const latestReview = extractActionValue(compact, [
    'latest_review',
    'latestReview',
    'review_id',
    'reviewId',
  ])
  const latestComment = extractActionValue(compact, [
    'latest_comment',
    'latestComment',
    'comment_id',
    'commentId',
    'comment',
  ])
  const failedChecks = extractFailedChecks(compact)
  const failureFingerprint = extractDigestValue(compact, [
    'failureFingerprint',
    'failure_fingerprint',
    'failure',
  ])
  const normalizedFailureFingerprint = failureFingerprint
    ? normalizeDigestToken(failureFingerprint)
    : null
  const explicitGate = gate ? `gate=${gate}` : null

  const isMerged = terminal === 'merged' || merged === true || state === 'merged'
  const isClosed = terminal === 'closed' || closed === true || state === 'closed'
  if (isMerged || isClosed) {
    return [
      `terminal=${isMerged ? 'merged' : 'closed'}`,
      head ? `head=${head}` : null,
      review ? `review=${review}` : null,
      latestReview ? `latest_review=${latestReview}` : null,
      latestComment ? `comment=${latestComment}` : null,
    ]
      .filter((item): item is string => item !== null)
      .join(';')
  }

  const canonicalParts = [
    head ? `head=${head}` : null,
    state ? `state=${state}` : null,
    review ? `review=${review}` : null,
    latestReview && !explicitGate ? `latest_review=${latestReview}` : null,
    latestComment && !explicitGate ? `comment=${latestComment}` : null,
    explicitGate,
    failedChecks.length > 0 && !explicitGate ? `failed=${failedChecks.join('|')}` : null,
    normalizedFailureFingerprint && !explicitGate
      ? `failure=${normalizedFailureFingerprint}`
      : null,
  ].filter((item): item is string => item !== null)

  if (canonicalParts.length === 0) {
    return compact
  }

  return canonicalParts.join(';')
}

function normalizeStructuredValue(value: string | number | undefined): string | null {
  if (value === undefined) {
    return null
  }
  const normalized = normalizeDigestToken(String(value))
  return normalized || null
}

function normalizeStructuredSha(value: string | undefined): string | null {
  const normalized = normalizeStructuredValue(value)
  return normalized ? normalized.toLowerCase() : null
}

function canonicalizeStructuredState(state: LedgerStateInput): string | null {
  const head = normalizeStructuredSha(state.headSha)
  const terminal = normalizeStructuredValue(state.terminal)
  const lifecycleState = normalizeStructuredValue(state.state)
  const review = normalizeStructuredValue(state.reviewDecision)
  const latestReview = normalizeStructuredValue(state.latestReviewId)
  const latestComment = normalizeStructuredValue(state.latestCommentId)
  const failedChecks = normalizeCheckNames(state.failedChecks)
  const failureFingerprint = normalizeStructuredValue(state.failureFingerprint)
  const gate = normalizeStructuredValue(state.gate)
  const explicitGate = gate ? `gate=${gate}` : null

  const isMerged = terminal === 'merged' || state.merged === true || lifecycleState === 'merged'
  const isClosed = terminal === 'closed' || state.closed === true || lifecycleState === 'closed'
  if (isMerged || isClosed) {
    return [
      `terminal=${isMerged ? 'merged' : 'closed'}`,
      head ? `head=${head}` : null,
      review ? `review=${review}` : null,
      latestReview ? `latest_review=${latestReview}` : null,
      latestComment ? `comment=${latestComment}` : null,
    ]
      .filter((item): item is string => item !== null)
      .join(';')
  }

  const canonicalParts = [
    head ? `head=${head}` : null,
    lifecycleState ? `state=${lifecycleState}` : null,
    state.merged === true ? 'merged=true' : null,
    state.closed === true ? 'closed=true' : null,
    review ? `review=${review}` : null,
    latestReview && !explicitGate ? `latest_review=${latestReview}` : null,
    latestComment && !explicitGate ? `comment=${latestComment}` : null,
    explicitGate,
    failedChecks.length > 0 && !explicitGate ? `failed=${failedChecks.join('|')}` : null,
    failureFingerprint && !explicitGate ? `failure=${failureFingerprint}` : null,
  ].filter((item): item is string => item !== null)

  return canonicalParts.length > 0 ? canonicalParts.join(';') : null
}

function buildStateDigest(event: LedgerEventInput): string {
  const structuredDigest = event.state ? canonicalizeStructuredState(event.state) : null
  if (structuredDigest) {
    return structuredDigest
  }
  const rawDigest = event.stateDigest?.trim()
  if (!rawDigest) {
    throw new Error(
      `github_monitor_ledger requires state or stateDigest for ${event.eventKey ?? 'synthetic event'}. Prefer structured state for new callers.`
    )
  }
  if (
    /(?:^|[;|,\n])\s*(?:latest[_-]?review[_-]?request(?:[_-]?id)?|review[_-]?request(?:[_-]?id)?)\s*[:=]/i.test(
      rawDigest
    )
  ) {
    throw new Error(
      'github_monitor_ledger review requests require exact sourceEvent.type + sourceEvent.id'
    )
  }
  return canonicalizeStateDigest(rawDigest)
}

type DigestComponent = {
  key: string
  value: string
}

type TerminalDigest = {
  terminal: 'merged' | 'closed'
  head: string | null
}

function parseDigestComponents(stateDigest: string): DigestComponent[] | null {
  const compact = compactDigest(stateDigest)
  if (!compact) {
    return []
  }

  const components: DigestComponent[] = []
  for (const rawPart of compact.split(';')) {
    const part = rawPart.trim()
    const match = /^([a-z][a-z0-9_-]*)=([^;]+)$/i.exec(part)
    if (!match) {
      return null
    }
    components.push({ key: match[1], value: match[2] })
  }
  return components
}

function digestHeadShasMatch(left: string, right: string): boolean {
  const leftSha = left.toLowerCase()
  const rightSha = right.toLowerCase()
  if (!/^[0-9a-f]{7,40}$/.test(leftSha) || !/^[0-9a-f]{7,40}$/.test(rightSha)) {
    return false
  }
  return leftSha.startsWith(rightSha) || rightSha.startsWith(leftSha)
}

function parseCanonicalTerminalDigest(
  components: readonly DigestComponent[]
): TerminalDigest | null {
  let terminal: TerminalDigest['terminal'] | null = null
  let head: string | null = null
  let hasReview = false

  for (const component of components) {
    const key = component.key.toLowerCase()
    const value = normalizeDigestToken(component.value)
    if (key === 'terminal') {
      if (terminal !== null || (value !== 'merged' && value !== 'closed')) {
        return null
      }
      terminal = value
      continue
    }
    if (key === 'head') {
      if (head !== null) {
        return null
      }
      head = value
      continue
    }
    if (key === 'review') {
      if (hasReview) {
        return null
      }
      hasReview = true
      continue
    }
    return null
  }

  return terminal ? { terminal, head } : null
}

function terminalDigestHeadsMatch(left: string | null, right: string | null): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return digestHeadShasMatch(left, right)
}

function stateDigestsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  const leftComponents = parseDigestComponents(left)
  const rightComponents = parseDigestComponents(right)
  if (!leftComponents || !rightComponents) {
    return false
  }

  const leftTerminal = parseCanonicalTerminalDigest(leftComponents)
  const rightTerminal = parseCanonicalTerminalDigest(rightComponents)
  if (leftTerminal && rightTerminal) {
    return (
      leftTerminal.terminal === rightTerminal.terminal &&
      terminalDigestHeadsMatch(leftTerminal.head, rightTerminal.head)
    )
  }

  if (leftComponents.length !== rightComponents.length) {
    return false
  }

  return leftComponents.every((leftComponent, index) => {
    const rightComponent = rightComponents[index]
    if (leftComponent.key !== rightComponent.key) {
      return false
    }
    if (leftComponent.value === rightComponent.value) {
      return true
    }
    return (
      leftComponent.key === 'head' && digestHeadShasMatch(leftComponent.value, rightComponent.value)
    )
  })
}

function digestComponentValue(components: readonly DigestComponent[], key: string): string | null {
  const item = components.find((component) => component.key.toLowerCase() === key)
  return item ? normalizeDigestToken(item.value) : null
}

function digestComponentValuesAreCompatible(
  leftComponents: readonly DigestComponent[],
  rightComponents: readonly DigestComponent[],
  key: string
): boolean {
  const left = digestComponentValue(leftComponents, key)
  const right = digestComponentValue(rightComponents, key)
  return !left || !right || left === right
}

function hasNewActionValue(
  leftComponents: readonly DigestComponent[],
  rightComponents: readonly DigestComponent[],
  key: string
): boolean {
  const previous = digestComponentValue(leftComponents, key)
  const current = digestComponentValue(rightComponents, key)
  return Boolean(current && current !== previous)
}

function sameHeadCiFailureFingerprintMatches(
  entry: LedgerEntry | undefined,
  event: NormalizedLedgerEventInput
): boolean {
  if (!entry?.lastHandledDigest) {
    return false
  }
  const leftComponents = parseDigestComponents(entry.lastHandledDigest)
  const rightComponents = parseDigestComponents(event.stateDigest)
  if (!leftComponents || !rightComponents) {
    return false
  }
  if (
    digestComponentValue(leftComponents, 'terminal') ||
    digestComponentValue(rightComponents, 'terminal')
  ) {
    return false
  }
  const leftHead = digestComponentValue(leftComponents, 'head')
  const rightHead = digestComponentValue(rightComponents, 'head')
  if (!leftHead || !rightHead || !digestHeadShasMatch(leftHead, rightHead)) {
    return false
  }
  const previousFailure = digestComponentValue(leftComponents, 'failure')
  const currentFailure = digestComponentValue(rightComponents, 'failure')
  if (!previousFailure || previousFailure !== currentFailure) {
    return false
  }
  if (
    !digestComponentValuesAreCompatible(leftComponents, rightComponents, 'state') ||
    !digestComponentValuesAreCompatible(leftComponents, rightComponents, 'review')
  ) {
    return false
  }
  return !['comment', 'latest_review'].some((key) =>
    hasNewActionValue(leftComponents, rightComponents, key)
  )
}

function suppressedSameHeadCiBackcheckMatches(
  entry: LedgerEntry | undefined,
  event: NormalizedLedgerEventInput
): boolean {
  if (entry?.lastHandledOutcome !== 'suppressed' || !entry.lastHandledDigest) {
    return false
  }
  const leftComponents = parseDigestComponents(entry.lastHandledDigest)
  const rightComponents = parseDigestComponents(event.stateDigest)
  if (!leftComponents || !rightComponents) {
    return false
  }
  if (
    digestComponentValue(leftComponents, 'terminal') ||
    digestComponentValue(rightComponents, 'terminal')
  ) {
    return false
  }
  const leftHead = digestComponentValue(leftComponents, 'head')
  const rightHead = digestComponentValue(rightComponents, 'head')
  if (!leftHead || !rightHead || !digestHeadShasMatch(leftHead, rightHead)) {
    return false
  }
  if (
    !digestComponentValue(leftComponents, 'failed') ||
    !digestComponentValue(rightComponents, 'failed')
  ) {
    return false
  }
  if (
    !digestComponentValuesAreCompatible(leftComponents, rightComponents, 'state') ||
    !digestComponentValuesAreCompatible(leftComponents, rightComponents, 'review')
  ) {
    return false
  }

  const previousComment = digestComponentValue(leftComponents, 'comment')
  const currentComment = digestComponentValue(rightComponents, 'comment')
  if (
    (!previousComment && currentComment) ||
    (previousComment && currentComment && previousComment !== currentComment)
  ) {
    return false
  }
  const previousReview = digestComponentValue(leftComponents, 'latest_review')
  const currentReview = digestComponentValue(rightComponents, 'latest_review')
  if (
    (!previousReview && currentReview) ||
    (previousReview && currentReview && previousReview !== currentReview)
  ) {
    return false
  }
  const previousFailure = digestComponentValue(leftComponents, 'failure')
  const currentFailure = digestComponentValue(rightComponents, 'failure')
  if (currentFailure && currentFailure !== previousFailure) {
    return false
  }

  return true
}

function normalizeEventInput(event: LedgerEventInput): NormalizedLedgerEventInput {
  const sourceIdentity = event.sourceEvent
    ? (() => {
        const kind = normalizeExactEventKind(event.sourceEvent.type)
        if (!kind) {
          throw new Error(
            `github_monitor_ledger does not recognize sourceEvent.type=${event.sourceEvent.type}`
          )
        }
        return { kind, id: normalizeExactEventId(event.sourceEvent.id) }
      })()
    : null
  if (sourceIdentity && event.eventKey?.trim()) {
    throw new Error(
      'github_monitor_ledger exact source events must omit eventKey; sourceEvent.type + sourceEvent.id are the identity'
    )
  }
  const canonicalStateDigest =
    event.state || event.stateDigest?.trim()
      ? buildStateDigest(event)
      : sourceIdentity
        ? exactEventDigest(sourceIdentity)
        : buildStateDigest(event)
  const syntheticEventKey = event.eventKey?.trim()
  if (!sourceIdentity && !syntheticEventKey) {
    throw new Error(
      'github_monitor_ledger synthetic events require eventKey; exact events require sourceEvent.type + sourceEvent.id'
    )
  }
  const eventKey = sourceIdentity
    ? exactEventKey(sourceIdentity)
    : canonicalizeEventKey(syntheticEventKey!)
  if (!sourceIdentity && !/^github:thread:\d+$/.test(eventKey)) {
    throw new Error(
      'github_monitor_ledger synthetic events require the current unread notification key github:thread:<thread_id>'
    )
  }
  const stateDigest = sourceIdentity ? exactEventDigest(sourceIdentity) : canonicalStateDigest
  return {
    ...event,
    actorLogin: event.actorLogin ?? event.sourceEvent?.actorLogin,
    eventKey,
    stateDigest,
  }
}

function mergeLedgerEntries(left: LedgerEntry, right: LedgerEntry): LedgerEntry {
  const rightSeenIsNewer = right.lastSeenAt.localeCompare(left.lastSeenAt) >= 0
  const leftHandledAt = left.lastHandledAt ?? ''
  const rightHandledAt = right.lastHandledAt ?? ''
  const rightHandledIsNewer = rightHandledAt.localeCompare(leftHandledAt) >= 0
  return {
    eventKey: left.eventKey,
    firstSeenAt:
      left.firstSeenAt.localeCompare(right.firstSeenAt) <= 0 ? left.firstSeenAt : right.firstSeenAt,
    lastSeenAt: rightSeenIsNewer ? right.lastSeenAt : left.lastSeenAt,
    lastSeenDigest: rightSeenIsNewer ? right.lastSeenDigest : left.lastSeenDigest,
    seenCount: left.seenCount + right.seenCount,
    actorLogin: right.actorLogin ?? left.actorLogin,
    requestedReviewerLogin: right.requestedReviewerLogin ?? left.requestedReviewerLogin,
    isSelfAuthored: left.isSelfAuthored || right.isSelfAuthored,
    lastHandledAt: rightHandledIsNewer ? right.lastHandledAt : left.lastHandledAt,
    lastHandledDigest: rightHandledIsNewer ? right.lastHandledDigest : left.lastHandledDigest,
    lastHandledOutcome: rightHandledIsNewer ? right.lastHandledOutcome : left.lastHandledOutcome,
    handledCount: left.handledCount + right.handledCount,
    targetSessionId: rightHandledIsNewer ? right.targetSessionId : left.targetSessionId,
    messageKind: rightHandledIsNewer ? right.messageKind : left.messageKind,
    intent: rightHandledIsNewer ? right.intent : left.intent,
  }
}

function normalizeLedgerEntry(entry: LedgerEntry, fallbackKey: string): LedgerEntry {
  const rawEventKey = entry.eventKey || fallbackKey
  const lastSeenDigest = canonicalizeStateDigest(entry.lastSeenDigest)
  const lastHandledDigest = entry.lastHandledDigest
    ? canonicalizeStateDigest(entry.lastHandledDigest)
    : null
  const exactIdentity = inferLegacyExactEvent(rawEventKey, lastHandledDigest ?? lastSeenDigest)
  const eventKey = exactIdentity ? exactEventKey(exactIdentity) : canonicalizeEventKey(rawEventKey)
  return {
    eventKey,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
    actorLogin: normalizeLogin(entry.actorLogin ?? undefined),
    requestedReviewerLogin: normalizeLogin(entry.requestedReviewerLogin ?? undefined),
    isSelfAuthored: entry.isSelfAuthored,
    lastSeenDigest: exactIdentity ? exactEventDigest(exactIdentity) : lastSeenDigest,
    seenCount: entry.seenCount,
    lastHandledAt: entry.lastHandledAt,
    lastHandledDigest:
      exactIdentity && lastHandledDigest ? exactEventDigest(exactIdentity) : lastHandledDigest,
    lastHandledOutcome: entry.lastHandledOutcome,
    handledCount: entry.handledCount,
    targetSessionId: entry.targetSessionId,
    messageKind: entry.messageKind,
    intent: entry.intent,
  }
}

function legacyCompositeExactEntries(entry: LedgerEntry, fallbackKey: string): LedgerEntry[] {
  const rawEventKey = entry.eventKey || fallbackKey
  if (!canonicalizeEventKey(rawEventKey).startsWith('github:thread:')) {
    return []
  }

  const seenIdentities = legacyCompositeExactEvents(entry.lastSeenDigest)
  const handledIdentities = legacyCompositeExactEvents(entry.lastHandledDigest)
  const handledKeys = new Set(handledIdentities.map(exactEventKey))
  const identities = new Map<string, ExactEventIdentity>()
  for (const identity of [...seenIdentities, ...handledIdentities]) {
    identities.set(exactEventKey(identity), identity)
  }

  return Array.from(identities.values(), (identity) => {
    const eventKey = exactEventKey(identity)
    const stateDigest = exactEventDigest(identity)
    const wasHandled = handledKeys.has(eventKey)
    return {
      ...entry,
      eventKey,
      actorLogin: normalizeLogin(entry.actorLogin ?? undefined),
      requestedReviewerLogin: normalizeLogin(entry.requestedReviewerLogin ?? undefined),
      lastSeenDigest: stateDigest,
      lastHandledAt: wasHandled ? entry.lastHandledAt : null,
      lastHandledDigest: wasHandled ? stateDigest : null,
      lastHandledOutcome: wasHandled ? entry.lastHandledOutcome : null,
      handledCount: wasHandled ? entry.handledCount : 0,
      targetSessionId: wasHandled ? entry.targetSessionId : null,
      messageKind: wasHandled ? entry.messageKind : null,
      intent: wasHandled ? entry.intent : null,
    }
  })
}

function normalizeLedgerEntries(entries: Record<string, LedgerEntry>): Record<string, LedgerEntry> {
  const normalized: Record<string, LedgerEntry> = {}
  const addEntry = (entry: LedgerEntry) => {
    const existing = normalized[entry.eventKey]
    normalized[entry.eventKey] = existing ? mergeLedgerEntries(existing, entry) : entry
  }
  for (const [key, entry] of Object.entries(entries)) {
    addEntry(normalizeLedgerEntry(entry, key))
  }
  const legacyExactEntries: Record<string, LedgerEntry> = {}
  for (const [key, entry] of Object.entries(entries)) {
    for (const exactEntry of legacyCompositeExactEntries(entry, key)) {
      const existing = legacyExactEntries[exactEntry.eventKey]
      legacyExactEntries[exactEntry.eventKey] = existing
        ? mergeLedgerEntries(existing, exactEntry)
        : exactEntry
    }
  }
  for (const exactEntry of Object.values(legacyExactEntries)) {
    if (!normalized[exactEntry.eventKey]) {
      addEntry(exactEntry)
    }
  }
  return normalized
}

function slugifySegment(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return slug || 'project'
}

function resolveProjectRoot(): string {
  try {
    return realpathSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    )
  } catch {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  }
}

function resolveLedgerLocation() {
  const projectRoot = resolveProjectRoot()
  const slug = slugifySegment(path.basename(projectRoot))
  const digest = createHash('sha1').update(projectRoot).digest('hex').slice(0, 12)
  const projectId = `${slug}-${digest}`
  const dir = path.join(os.homedir(), '.nyakore', 'integrations', 'github-monitor', projectId)
  return {
    projectId,
    projectRoot,
    dir,
    ledgerPath: path.join(dir, 'ledger.json'),
    lockPath: path.join(dir, 'ledger.lock'),
  }
}

function defaultState(location: ReturnType<typeof resolveLedgerLocation>): LedgerState {
  return {
    version: 1,
    projectId: location.projectId,
    projectRoot: location.projectRoot,
    updatedAt: new Date(0).toISOString(),
    entries: {},
  }
}

async function readLedgerState(
  location: ReturnType<typeof resolveLedgerLocation>
): Promise<LedgerState> {
  try {
    const raw = await readFile(location.ledgerPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LedgerState> | null
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.projectRoot !== 'string' ||
      !parsed.entries ||
      typeof parsed.entries !== 'object' ||
      Array.isArray(parsed.entries)
    ) {
      return defaultState(location)
    }
    return {
      version: 1,
      projectId: parsed.projectId,
      projectRoot: parsed.projectRoot,
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : defaultState(location).updatedAt,
      entries: normalizeLedgerEntries(parsed.entries as Record<string, LedgerEntry>),
    }
  } catch {
    return defaultState(location)
  }
}

async function writeLedgerState(
  location: ReturnType<typeof resolveLedgerLocation>,
  state: LedgerState
): Promise<void> {
  await mkdir(location.dir, { recursive: true })
  const tmpPath = `${location.ledgerPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmpPath, location.ledgerPath)
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      await mkdir(lockPath)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('EEXIST')) {
        throw error
      }
      if (Date.now() >= deadline) {
        throw new Error(`github monitor ledger lock timed out: ${lockPath}`)
      }
      await delay(LOCK_RETRY_MS)
    }
  }
}

async function withLedgerState<T>(
  updater: (state: LedgerState, location: ReturnType<typeof resolveLedgerLocation>) => Promise<T>
): Promise<T> {
  const location = resolveLedgerLocation()
  mkdirSync(location.dir, { recursive: true })
  await acquireLock(location.lockPath)
  try {
    const state = await readLedgerState(location)
    const result = await updater(state, location)
    state.updatedAt = new Date().toISOString()
    pruneLedgerState(state)
    await writeLedgerState(location, state)
    return result
  } finally {
    await rm(location.lockPath, { recursive: true, force: true })
  }
}

function pruneLedgerState(state: LedgerState): void {
  const cutoffMs = Date.now() - DEFAULT_PRUNE_DAYS * 24 * 60 * 60 * 1000
  const entries = Object.entries(state.entries).filter(([, entry]) => {
    const lastSeenMs = Date.parse(entry.lastSeenAt)
    return Number.isFinite(lastSeenMs) && lastSeenMs >= cutoffMs
  })
  entries.sort((left, right) => right[1].lastSeenAt.localeCompare(left[1].lastSeenAt))
  state.entries = Object.fromEntries(entries.slice(0, MAX_ENTRIES))
}

function ensureEvents(input: GithubMonitorLedgerInput): NormalizedLedgerEventInput[] {
  if (!Array.isArray(input.events) || input.events.length === 0) {
    throw new Error('github_monitor_ledger requires a non-empty events array')
  }
  return input.events.map(normalizeEventInput)
}

function ensureOutcome(event: NormalizedLedgerEventInput): LedgerOutcome {
  if (event.outcome === 'routed' || event.outcome === 'suppressed') {
    return event.outcome
  }
  throw new Error(
    `github_monitor_ledger record requires outcome for ${event.eventKey}. Use routed or suppressed.`
  )
}

function createEmptyEntry(
  event: NormalizedLedgerEventInput,
  isSelfAuthored: boolean,
  now: string
): LedgerEntry {
  return {
    eventKey: event.eventKey,
    firstSeenAt: now,
    lastSeenAt: now,
    lastSeenDigest: event.stateDigest,
    seenCount: 0,
    actorLogin: normalizeLogin(event.actorLogin),
    requestedReviewerLogin: normalizeLogin(event.requestedReviewerLogin),
    isSelfAuthored,
    lastHandledAt: null,
    lastHandledDigest: null,
    lastHandledOutcome: null,
    handledCount: 0,
    targetSessionId: null,
    messageKind: null,
    intent: null,
  }
}

function resolveSeenStatus(
  entry: LedgerEntry | undefined,
  event: NormalizedLedgerEventInput
): SeenStatus {
  if (!entry) {
    return 'new'
  }
  return stateDigestsMatch(entry.lastSeenDigest, event.stateDigest) ? 'seen_repeat' : 'seen_changed'
}

function resolveHandledStatus(
  entry: LedgerEntry | undefined,
  event: NormalizedLedgerEventInput
): HandledStatus {
  if (!entry?.lastHandledDigest) {
    return 'unhandled'
  }
  return stateDigestsMatch(entry.lastHandledDigest, event.stateDigest) ||
    sameHeadCiFailureFingerprintMatches(entry, event) ||
    suppressedSameHeadCiBackcheckMatches(entry, event)
    ? 'handled_repeat'
    : 'handled_changed'
}

function summarizeCheck(results: CheckResult[]): string {
  const summary = {
    total: results.length,
    shouldAct: results.filter((item) => item.shouldAct).length,
    selfAuthored: results.filter((item) => item.isSelfAuthored).length,
    seenNew: results.filter((item) => item.seenStatus === 'new').length,
    seenChanged: results.filter((item) => item.seenStatus === 'seen_changed').length,
    handledRepeat: results.filter((item) => item.handledStatus === 'handled_repeat').length,
  }
  return [
    `checked ${summary.total} event(s)`,
    `should_act=${summary.shouldAct}`,
    `self_authored=${summary.selfAuthored}`,
    `seen_new=${summary.seenNew}`,
    `seen_changed=${summary.seenChanged}`,
    `handled_repeat=${summary.handledRepeat}`,
  ].join(' | ')
}

function summarizeRecord(results: RecordResult[]): string {
  const routed = results.filter((item) => item.outcome === 'routed').length
  const suppressed = results.filter((item) => item.outcome === 'suppressed').length
  const changed = results.filter((item) => item.handledStatus === 'handled_changed').length
  return [
    `recorded ${results.length} event(s)`,
    `routed=${routed}`,
    `suppressed=${suppressed}`,
    `handled_changed=${changed}`,
  ].join(' | ')
}

async function handleCheck(input: GithubMonitorLedgerInput) {
  const selfLogins = buildLoginSet(input.selfLogins)
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureEvents(input).map((event) => {
      const existing = state.entries[event.eventKey]
      const actorLogin = normalizeLogin(event.actorLogin)
      const requestedReviewerLogin = normalizeLogin(event.requestedReviewerLogin)
      const isSelfAuthored = actorLogin
        ? selfLogins.has(actorLogin)
        : (existing?.isSelfAuthored ?? false)
      const seenStatus = resolveSeenStatus(existing, event)
      const handledStatus = resolveHandledStatus(existing, event)
      const next = existing
        ? {
            ...existing,
            actorLogin: actorLogin ?? existing.actorLogin,
            requestedReviewerLogin:
              requestedReviewerLogin ?? existing.requestedReviewerLogin ?? null,
            isSelfAuthored,
            lastSeenAt: now,
            lastSeenDigest: event.stateDigest,
          }
        : createEmptyEntry(event, isSelfAuthored, now)
      next.seenCount += 1
      state.entries[event.eventKey] = next
      return {
        eventKey: event.eventKey,
        stateDigest: event.stateDigest,
        actorLogin: next.actorLogin,
        requestedReviewerLogin: next.requestedReviewerLogin,
        isSelfAuthored,
        seenStatus,
        handledStatus,
        shouldAct: handledStatus !== 'handled_repeat',
        lastHandledOutcome: next.lastHandledOutcome,
        lastHandledAt: next.lastHandledAt,
        seenCount: next.seenCount,
        handledCount: next.handledCount,
      } satisfies CheckResult
    })
  })

  return {
    content: [{ type: 'text', text: summarizeCheck(results) }],
    details: {
      action: 'check',
      ledgerPath: resolveLedgerLocation().ledgerPath,
      results,
    },
  }
}

async function handleRecord(input: GithubMonitorLedgerInput) {
  const selfLogins = buildLoginSet(input.selfLogins)
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureEvents(input).map((event) => {
      const existing = state.entries[event.eventKey]
      const actorLogin = normalizeLogin(event.actorLogin) ?? existing?.actorLogin ?? null
      const requestedReviewerLogin =
        normalizeLogin(event.requestedReviewerLogin) ?? existing?.requestedReviewerLogin ?? null
      const isSelfAuthored = actorLogin
        ? selfLogins.has(actorLogin)
        : (existing?.isSelfAuthored ?? false)
      const outcome = ensureOutcome(event)
      const handledStatus = resolveHandledStatus(existing, event)
      const next = existing
        ? {
            ...existing,
            actorLogin,
            requestedReviewerLogin,
            isSelfAuthored,
            lastSeenAt: existing.lastSeenAt,
            lastSeenDigest: existing.lastSeenDigest,
          }
        : createEmptyEntry(event, isSelfAuthored, now)
      if (!existing) {
        next.seenCount = 1
      }
      const matchesLastHandledDigest = stateDigestsMatch(
        existing?.lastHandledDigest,
        event.stateDigest
      )
      const isDuplicateRecord = matchesLastHandledDigest && existing?.lastHandledOutcome === outcome
      const preservesExistingSuppression =
        matchesLastHandledDigest &&
        existing?.lastHandledOutcome === 'suppressed' &&
        outcome === 'routed'
      if (!isDuplicateRecord && !preservesExistingSuppression) {
        next.lastHandledAt = now
        next.lastHandledDigest = event.stateDigest
        next.lastHandledOutcome = outcome
        next.handledCount += 1
        next.targetSessionId = event.targetSessionId?.trim() || null
        next.messageKind = event.messageKind?.trim() || null
        next.intent = event.intent?.trim() || null
      }
      state.entries[event.eventKey] = next
      return {
        eventKey: event.eventKey,
        stateDigest: event.stateDigest,
        outcome: next.lastHandledOutcome ?? outcome,
        requestedOutcome: outcome,
        handledStatus,
        actorLogin: next.actorLogin,
        requestedReviewerLogin: next.requestedReviewerLogin,
        isSelfAuthored,
        handledCount: next.handledCount,
        targetSessionId: next.targetSessionId,
        messageKind: next.messageKind,
        intent: next.intent,
      } satisfies RecordResult
    })
  })

  return {
    content: [{ type: 'text', text: summarizeRecord(results) }],
    details: {
      action: 'record',
      ledgerPath: resolveLedgerLocation().ledgerPath,
      results,
    },
  }
}

async function handleStats() {
  const summary = await withLedgerState(async (state, location) => {
    const entries = Object.values(state.entries)
    return {
      action: 'stats',
      ledgerPath: location.ledgerPath,
      projectId: state.projectId,
      projectRoot: state.projectRoot,
      totalEntries: entries.length,
      selfAuthoredEntries: entries.filter((entry) => entry.isSelfAuthored).length,
      handledEntries: entries.filter((entry) => entry.lastHandledDigest !== null).length,
      updatedAt: state.updatedAt,
    }
  })
  return {
    content: [
      {
        type: 'text',
        text: `ledger entries=${summary.totalEntries} handled=${summary.handledEntries} self=${summary.selfAuthoredEntries}`,
      },
    ],
    details: summary,
  }
}

export default function registerGithubMonitorLedgerTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'github_monitor_ledger',
    label: 'github monitor ledger',
    description:
      'Persist cross-run GitHub notification dedup state. Use the same sourceEvent for exact-event check/record; synthetic state uses the current unread github:thread:<thread_id>. Record after a successful route or intentional suppression.',
    parameters: githubMonitorLedgerSchema,
    execute: async (_toolCallId, input: GithubMonitorLedgerInput) => {
      if (input.action === 'check') {
        return await handleCheck(input)
      }
      if (input.action === 'record') {
        return await handleRecord(input)
      }
      return await handleStats()
    },
  })
}

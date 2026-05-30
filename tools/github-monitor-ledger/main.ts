import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
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
  },
  { additionalProperties: false }
)

const ledgerEventSchema = Type.Object(
  {
    eventKey: Type.String({
      description: 'Stable dedup key for one GitHub notification or synthesized state event.',
    }),
    state: Type.Optional(ledgerStateSchema),
    stateDigest: Type.Optional(
      Type.String({
        description:
          'Legacy free-form digest of the current actionable state. Prefer state for new callers; this field remains supported and is normalized by the tool.',
      })
    ),
    actorLogin: Type.Optional(
      Type.String({
        description: 'GitHub login that authored or triggered the event when known.',
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
        description: 'NNP message kind used when recording handling, such as inform or request.',
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
    ignoredActorLogins: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Additional GitHub logins that should be auto-suppressed when matching actorLogin values. Project defaults are loaded from [policy.github_monitor].ignored_actor_logins in runtime.toml.',
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
type NormalizedLedgerEventInput = Omit<LedgerEventInput, 'stateDigest'> & { stateDigest: string }
type LedgerOutcome = 'routed' | 'suppressed'
type SeenStatus = 'new' | 'seen_repeat' | 'seen_changed'
type HandledStatus = 'unhandled' | 'handled_repeat' | 'handled_changed'

type LedgerEntry = {
  eventKey: string
  firstSeenAt: string
  lastSeenAt: string
  lastSeenDigest: string
  seenCount: number
  actorLogin: string | null
  isSelfAuthored: boolean
  isIgnoredActor: boolean
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
  isSelfAuthored: boolean
  isIgnoredActor: boolean
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
  handledStatus: HandledStatus
  actorLogin: string | null
  isSelfAuthored: boolean
  isIgnoredActor: boolean
  handledCount: number
  targetSessionId: string | null
  messageKind: string | null
  intent: string | null
}

function normalizeLogin(login: string | undefined): string | null {
  const trimmed = login?.trim()
  return trimmed ? trimmed.toLowerCase() : null
}

function buildLoginSet(logins: readonly string[] | undefined, defaults: readonly string[] = []) {
  return new Set(
    [...defaults, ...(logins ?? [])]
      .map((login) => normalizeLogin(login))
      .filter((login): login is string => login !== null)
  )
}

function canonicalizeEventKey(eventKey: string): string {
  const trimmed = eventKey.trim()
  const sessionPrMatch =
    /^(?:github:)?session-pr(?:-state)?[\s:#_-]+([^:\s]+):([^:#\s]+\/[^:#\s]+)[:#](\d+)$/i.exec(
      trimmed
    )
  if (sessionPrMatch) {
    return `github:session-pr:${sessionPrMatch[1]}:${sessionPrMatch[2]}#${sessionPrMatch[3]}`
  }
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
    const match = new RegExp(`(?:^|[;|,\\n])\\s*${key}\\s*[:=]\\s*([^;|\\n]+)`, 'i').exec(digest)
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

  const isMerged = terminal === 'merged' || merged === true || state === 'merged'
  const isClosed = terminal === 'closed' || closed === true || state === 'closed'
  if (isMerged || isClosed) {
    return [
      `terminal=${isMerged ? 'merged' : 'closed'}`,
      head ? `head=${head}` : null,
      review ? `review=${review}` : null,
    ]
      .filter((item): item is string => item !== null)
      .join(';')
  }

  const canonicalParts = [
    head ? `head=${head}` : null,
    state ? `state=${state}` : null,
    merged === true ? 'merged=true' : null,
    closed === true ? 'closed=true' : null,
    review ? `review=${review}` : null,
    latestReview ? `latest_review=${latestReview}` : null,
    latestComment ? `comment=${latestComment}` : null,
    failedChecks.length > 0 ? `failed=${failedChecks.join('|')}` : null,
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

  const isMerged = terminal === 'merged' || state.merged === true || lifecycleState === 'merged'
  const isClosed = terminal === 'closed' || state.closed === true || lifecycleState === 'closed'
  if (isMerged || isClosed) {
    return [
      `terminal=${isMerged ? 'merged' : 'closed'}`,
      head ? `head=${head}` : null,
      review ? `review=${review}` : null,
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
    latestReview ? `latest_review=${latestReview}` : null,
    latestComment ? `comment=${latestComment}` : null,
    failedChecks.length > 0 ? `failed=${failedChecks.join('|')}` : null,
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
      `github_monitor_ledger requires state or stateDigest for ${event.eventKey}. Prefer structured state for new callers.`
    )
  }
  return canonicalizeStateDigest(rawDigest)
}

function normalizeEventInput(event: LedgerEventInput): NormalizedLedgerEventInput {
  const eventKey = canonicalizeEventKey(event.eventKey)
  const stateDigest = buildStateDigest(event)
  return { ...event, eventKey, stateDigest }
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
    isSelfAuthored: left.isSelfAuthored || right.isSelfAuthored,
    isIgnoredActor: left.isIgnoredActor || right.isIgnoredActor,
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
  const eventKey = canonicalizeEventKey(entry.eventKey || fallbackKey)
  return {
    ...entry,
    eventKey,
    lastSeenDigest: canonicalizeStateDigest(entry.lastSeenDigest),
    lastHandledDigest: entry.lastHandledDigest
      ? canonicalizeStateDigest(entry.lastHandledDigest)
      : null,
  }
}

function normalizeLedgerEntries(entries: Record<string, LedgerEntry>): Record<string, LedgerEntry> {
  const normalized: Record<string, LedgerEntry> = {}
  for (const [key, entry] of Object.entries(entries)) {
    const next = normalizeLedgerEntry(entry, key)
    const existing = normalized[next.eventKey]
    normalized[next.eventKey] = existing ? mergeLedgerEntries(existing, next) : next
  }
  return normalized
}

function slugifySegment(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return slug || 'project'
}

function resolveProjectRoot(): string {
  try {
    return realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'))
  } catch {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  }
}

function parseTomlStringArray(section: string, key: string): string[] {
  const pattern = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm')
  const match = pattern.exec(section)
  if (!match) {
    return []
  }
  return Array.from(match[1].matchAll(/"((?:\\.|[^"\\])*)"/g), (item) => {
    try {
      return JSON.parse(`"${item[1]}"`) as string
    } catch {
      return item[1]
    }
  }).filter((item) => item.trim())
}

function readConfiguredIgnoredActorLogins(projectRoot = resolveProjectRoot()): string[] {
  try {
    const raw = readFileSync(path.join(projectRoot, 'runtime.toml'), 'utf8')
    const sectionMatch = /(?:^|\n)\[policy\.github_monitor\]\s*\n([\s\S]*?)(?=\n\[|$)/.exec(raw)
    return sectionMatch ? parseTomlStringArray(sectionMatch[1], 'ignored_actor_logins') : []
  } catch {
    return []
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
  isIgnoredActor: boolean,
  now: string
): LedgerEntry {
  return {
    eventKey: event.eventKey,
    firstSeenAt: now,
    lastSeenAt: now,
    lastSeenDigest: event.stateDigest,
    seenCount: 0,
    actorLogin: normalizeLogin(event.actorLogin),
    isSelfAuthored,
    isIgnoredActor,
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
  return entry.lastSeenDigest === event.stateDigest ? 'seen_repeat' : 'seen_changed'
}

function resolveHandledStatus(
  entry: LedgerEntry | undefined,
  event: NormalizedLedgerEventInput
): HandledStatus {
  if (!entry?.lastHandledDigest) {
    return 'unhandled'
  }
  return entry.lastHandledDigest === event.stateDigest ? 'handled_repeat' : 'handled_changed'
}

function summarizeCheck(results: CheckResult[]): string {
  const summary = {
    total: results.length,
    shouldAct: results.filter((item) => item.shouldAct).length,
    selfAuthored: results.filter((item) => item.isSelfAuthored).length,
    ignoredActor: results.filter((item) => item.isIgnoredActor).length,
    seenNew: results.filter((item) => item.seenStatus === 'new').length,
    seenChanged: results.filter((item) => item.seenStatus === 'seen_changed').length,
    handledRepeat: results.filter((item) => item.handledStatus === 'handled_repeat').length,
  }
  return [
    `checked ${summary.total} event(s)`,
    `should_act=${summary.shouldAct}`,
    `self_authored=${summary.selfAuthored}`,
    `ignored_actor=${summary.ignoredActor}`,
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
  const ignoredActorLogins = buildLoginSet(
    input.ignoredActorLogins,
    readConfiguredIgnoredActorLogins()
  )
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureEvents(input).map((event) => {
      const existing = state.entries[event.eventKey]
      const actorLogin = normalizeLogin(event.actorLogin)
      const isSelfAuthored = actorLogin
        ? selfLogins.has(actorLogin)
        : (existing?.isSelfAuthored ?? false)
      const isIgnoredActor = actorLogin
        ? ignoredActorLogins.has(actorLogin)
        : (existing?.isIgnoredActor ?? false)
      const seenStatus = resolveSeenStatus(existing, event)
      const handledStatus = resolveHandledStatus(existing, event)
      const next = existing
        ? {
            ...existing,
            actorLogin: actorLogin ?? existing.actorLogin,
            isSelfAuthored,
            isIgnoredActor,
            lastSeenAt: now,
            lastSeenDigest: event.stateDigest,
          }
        : createEmptyEntry(event, isSelfAuthored, isIgnoredActor, now)
      next.seenCount += 1
      if (isIgnoredActor && next.lastHandledDigest !== event.stateDigest) {
        next.lastHandledAt = now
        next.lastHandledDigest = event.stateDigest
        next.lastHandledOutcome = 'suppressed'
        next.handledCount += 1
        next.targetSessionId = null
        next.messageKind = null
        next.intent = 'github.notification.ignored_actor'
      }
      state.entries[event.eventKey] = next
      return {
        eventKey: event.eventKey,
        stateDigest: event.stateDigest,
        actorLogin: next.actorLogin,
        isSelfAuthored,
        isIgnoredActor,
        seenStatus,
        handledStatus,
        shouldAct: !isIgnoredActor && next.lastHandledDigest !== event.stateDigest,
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
  const ignoredActorLogins = buildLoginSet(
    input.ignoredActorLogins,
    readConfiguredIgnoredActorLogins()
  )
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureEvents(input).map((event) => {
      const existing = state.entries[event.eventKey]
      const actorLogin = normalizeLogin(event.actorLogin) ?? existing?.actorLogin ?? null
      const isSelfAuthored = actorLogin
        ? selfLogins.has(actorLogin)
        : (existing?.isSelfAuthored ?? false)
      const isIgnoredActor = actorLogin
        ? ignoredActorLogins.has(actorLogin)
        : (existing?.isIgnoredActor ?? false)
      const outcome = ensureOutcome(event)
      const handledStatus = resolveHandledStatus(existing, event)
      const next = existing
        ? {
            ...existing,
            actorLogin,
            isSelfAuthored,
            isIgnoredActor,
            lastSeenAt: existing.lastSeenAt,
            lastSeenDigest: existing.lastSeenDigest,
          }
        : createEmptyEntry(event, isSelfAuthored, isIgnoredActor, now)
      if (!existing) {
        next.seenCount = 1
      }
      const isDuplicateRecord =
        existing?.lastHandledDigest === event.stateDigest && existing.lastHandledOutcome === outcome
      if (!isDuplicateRecord) {
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
        outcome,
        handledStatus,
        actorLogin: next.actorLogin,
        isSelfAuthored,
        isIgnoredActor,
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
      ignoredActorEntries: entries.filter((entry) => entry.isIgnoredActor).length,
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
      'Persist cross-run GitHub monitor dedup state outside chat memory. Use check before routing and record after a successful route or intentional suppression. Prefer structured state over free-form stateDigest.',
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

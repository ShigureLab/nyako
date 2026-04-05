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

const ledgerEventSchema = Type.Object(
  {
    eventKey: Type.String({
      description: 'Stable dedup key for one GitHub notification or synthesized state event.',
    }),
    stateDigest: Type.String({
      description: 'Digest of the current actionable state, not just the raw notification id.',
    }),
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
  handledCount: number
  targetSessionId: string | null
  messageKind: string | null
  intent: string | null
}

function normalizeLogin(login: string | undefined): string | null {
  const trimmed = login?.trim()
  return trimmed ? trimmed.toLowerCase() : null
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
      entries: parsed.entries as Record<string, LedgerEntry>,
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

function ensureEvents(input: GithubMonitorLedgerInput): LedgerEventInput[] {
  if (!Array.isArray(input.events) || input.events.length === 0) {
    throw new Error('github_monitor_ledger requires a non-empty events array')
  }
  return input.events
}

function ensureOutcome(event: LedgerEventInput): LedgerOutcome {
  if (event.outcome === 'routed' || event.outcome === 'suppressed') {
    return event.outcome
  }
  throw new Error(
    `github_monitor_ledger record requires outcome for ${event.eventKey}. Use routed or suppressed.`
  )
}

function createEmptyEntry(
  event: LedgerEventInput,
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

function resolveSeenStatus(entry: LedgerEntry | undefined, event: LedgerEventInput): SeenStatus {
  if (!entry) {
    return 'new'
  }
  return entry.lastSeenDigest === event.stateDigest ? 'seen_repeat' : 'seen_changed'
}

function resolveHandledStatus(
  entry: LedgerEntry | undefined,
  event: LedgerEventInput
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
  const selfLogins = new Set((input.selfLogins ?? []).map(normalizeLogin).filter(Boolean))
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureEvents(input).map((event) => {
      const existing = state.entries[event.eventKey]
      const actorLogin = normalizeLogin(event.actorLogin)
      const isSelfAuthored = actorLogin
        ? selfLogins.has(actorLogin)
        : (existing?.isSelfAuthored ?? false)
      const seenStatus = resolveSeenStatus(existing, event)
      const handledStatus = resolveHandledStatus(existing, event)
      const next = existing
        ? {
            ...existing,
            actorLogin: actorLogin ?? existing.actorLogin,
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
        isSelfAuthored,
        seenStatus,
        handledStatus,
        shouldAct: next.lastHandledDigest !== event.stateDigest,
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
  const selfLogins = new Set((input.selfLogins ?? []).map(normalizeLogin).filter(Boolean))
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureEvents(input).map((event) => {
      const existing = state.entries[event.eventKey]
      const actorLogin = normalizeLogin(event.actorLogin) ?? existing?.actorLogin ?? null
      const isSelfAuthored = actorLogin
        ? selfLogins.has(actorLogin)
        : (existing?.isSelfAuthored ?? false)
      const outcome = ensureOutcome(event)
      const handledStatus = resolveHandledStatus(existing, event)
      const next = existing
        ? {
            ...existing,
            actorLogin,
            isSelfAuthored,
            lastSeenAt: existing.lastSeenAt,
            lastSeenDigest: existing.lastSeenDigest,
          }
        : createEmptyEntry(event, isSelfAuthored, now)
      if (!existing) {
        next.seenCount = 1
      }
      next.lastHandledAt = now
      next.lastHandledDigest = event.stateDigest
      next.lastHandledOutcome = outcome
      next.handledCount += 1
      next.targetSessionId = event.targetSessionId?.trim() || null
      next.messageKind = event.messageKind?.trim() || null
      next.intent = event.intent?.trim() || null
      state.entries[event.eventKey] = next
      return {
        eventKey: event.eventKey,
        stateDigest: event.stateDigest,
        outcome,
        handledStatus,
        actorLogin: next.actorLogin,
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
      'Persist cross-run GitHub monitor dedup state outside chat memory. Use check before routing and record after a successful route or intentional suppression.',
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

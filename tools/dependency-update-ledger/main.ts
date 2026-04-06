import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type, type Static } from '@sinclair/typebox'

const DEFAULT_PRUNE_DAYS = 400
const MAX_ENTRIES = 2000
const LOCK_TIMEOUT_MS = 5000
const LOCK_RETRY_MS = 50

const dependencyUpdateSchema = Type.Object(
  {
    action: Type.Union([Type.Literal('check'), Type.Literal('record'), Type.Literal('stats')]),
    updates: Type.Optional(
      Type.Array(
        Type.Object(
          {
            repo: Type.String({
              description: 'Target repository slug, for example PaddlePaddle/Paddle.',
            }),
            dependency: Type.String({
              description: 'Stable dependency name, for example ruff or ast-grep.',
            }),
            targetMinor: Type.String({
              description: 'Stable major.minor dedup key, for example 0.13.',
            }),
            targetVersion: Type.String({
              description: 'Exact version currently considered for that minor, for example 0.13.1.',
            }),
            outcome: Type.Optional(
              Type.Union([Type.Literal('opened'), Type.Literal('suppressed')], {
                description:
                  'Handled outcome. Use opened after creating a PR, or suppressed after intentionally skipping a repeated minor.',
              })
            ),
            prNumber: Type.Optional(
              Type.Integer({
                description: 'Pull request number created for this minor when outcome=opened.',
              })
            ),
            note: Type.Optional(
              Type.String({
                description:
                  'Optional short note describing why the minor was opened or suppressed.',
              })
            ),
          },
          { additionalProperties: false }
        ),
        {
          description: 'Dependency updates to check or record.',
        }
      )
    ),
  },
  { additionalProperties: false }
)

type DependencyUpdateLedgerInput = Static<typeof dependencyUpdateSchema>
type DependencyUpdateInput = NonNullable<DependencyUpdateLedgerInput['updates']>[number]
type LedgerOutcome = 'opened' | 'suppressed'
type SeenStatus = 'new' | 'seen_repeat' | 'seen_version_changed'

type LedgerEntry = {
  key: string
  repo: string
  dependency: string
  targetMinor: string
  firstSeenAt: string
  lastSeenAt: string
  lastSeenVersion: string
  seenCount: number
  lastHandledAt: string | null
  lastHandledVersion: string | null
  lastHandledOutcome: LedgerOutcome | null
  handledCount: number
  prNumber: number | null
  note: string | null
}

type LedgerState = {
  version: 1
  projectId: string
  projectRoot: string
  updatedAt: string
  entries: Record<string, LedgerEntry>
}

type CheckResult = {
  key: string
  repo: string
  dependency: string
  targetMinor: string
  targetVersion: string
  seenStatus: SeenStatus
  handled: boolean
  shouldAct: boolean
  lastHandledOutcome: LedgerOutcome | null
  lastHandledVersion: string | null
  prNumber: number | null
  seenCount: number
  handledCount: number
}

type RecordResult = {
  key: string
  repo: string
  dependency: string
  targetMinor: string
  targetVersion: string
  outcome: LedgerOutcome
  handledCount: number
  prNumber: number | null
  note: string | null
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
  const dir = path.join(os.homedir(), '.nyakore', 'integrations', 'dependency-update', projectId)
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
        throw new Error(`dependency update ledger lock timed out: ${lockPath}`)
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

function ensureUpdates(input: DependencyUpdateLedgerInput): DependencyUpdateInput[] {
  if (!Array.isArray(input.updates) || input.updates.length === 0) {
    throw new Error('dependency_update_ledger requires a non-empty updates array')
  }
  return input.updates
}

function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase()
}

function normalizeDependency(dependency: string): string {
  return dependency.trim().toLowerCase()
}

function buildKey(update: DependencyUpdateInput): string {
  return `${normalizeRepo(update.repo)}#${normalizeDependency(update.dependency)}#${update.targetMinor.trim()}`
}

function createEmptyEntry(update: DependencyUpdateInput, now: string): LedgerEntry {
  return {
    key: buildKey(update),
    repo: update.repo,
    dependency: update.dependency,
    targetMinor: update.targetMinor,
    firstSeenAt: now,
    lastSeenAt: now,
    lastSeenVersion: update.targetVersion,
    seenCount: 0,
    lastHandledAt: null,
    lastHandledVersion: null,
    lastHandledOutcome: null,
    handledCount: 0,
    prNumber: null,
    note: null,
  }
}

function summarizeCheck(results: CheckResult[]): string {
  const summary = {
    total: results.length,
    shouldAct: results.filter((item) => item.shouldAct).length,
    handled: results.filter((item) => item.handled).length,
    versionChanged: results.filter((item) => item.seenStatus === 'seen_version_changed').length,
  }
  return [
    `checked ${summary.total} update(s)`,
    `should_act=${summary.shouldAct}`,
    `handled=${summary.handled}`,
    `version_changed=${summary.versionChanged}`,
  ].join(' | ')
}

function summarizeRecord(results: RecordResult[]): string {
  const opened = results.filter((item) => item.outcome === 'opened').length
  const suppressed = results.filter((item) => item.outcome === 'suppressed').length
  return [
    `recorded ${results.length} update(s)`,
    `opened=${opened}`,
    `suppressed=${suppressed}`,
  ].join(' | ')
}

async function handleCheck(input: DependencyUpdateLedgerInput) {
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureUpdates(input).map((update) => {
      const key = buildKey(update)
      const existing = state.entries[key]
      const seenStatus: SeenStatus = !existing
        ? 'new'
        : existing.lastSeenVersion === update.targetVersion
          ? 'seen_repeat'
          : 'seen_version_changed'
      const next = existing
        ? {
            ...existing,
            repo: update.repo,
            dependency: update.dependency,
            targetMinor: update.targetMinor,
            lastSeenAt: now,
            lastSeenVersion: update.targetVersion,
          }
        : createEmptyEntry(update, now)
      next.seenCount += 1
      state.entries[key] = next
      return {
        key,
        repo: update.repo,
        dependency: update.dependency,
        targetMinor: update.targetMinor,
        targetVersion: update.targetVersion,
        seenStatus,
        handled: next.lastHandledOutcome !== null,
        shouldAct: next.lastHandledOutcome === null,
        lastHandledOutcome: next.lastHandledOutcome,
        lastHandledVersion: next.lastHandledVersion,
        prNumber: next.prNumber,
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

function ensureOutcome(update: DependencyUpdateInput): LedgerOutcome {
  if (update.outcome === 'opened' || update.outcome === 'suppressed') {
    return update.outcome
  }
  throw new Error(
    `dependency_update_ledger record requires outcome for ${update.dependency}@${update.targetMinor}`
  )
}

async function handleRecord(input: DependencyUpdateLedgerInput) {
  const results = await withLedgerState(async (state) => {
    const now = new Date().toISOString()
    return ensureUpdates(input).map((update) => {
      const key = buildKey(update)
      const existing = state.entries[key]
      const outcome = ensureOutcome(update)
      const next = existing
        ? {
            ...existing,
            repo: update.repo,
            dependency: update.dependency,
            targetMinor: update.targetMinor,
          }
        : createEmptyEntry(update, now)
      if (!existing) {
        next.seenCount = 1
      }
      next.lastSeenAt = now
      next.lastSeenVersion = update.targetVersion
      next.lastHandledAt = now
      next.lastHandledVersion = update.targetVersion
      next.lastHandledOutcome = outcome
      next.handledCount += 1
      next.prNumber = typeof update.prNumber === 'number' ? update.prNumber : null
      next.note = update.note?.trim() || null
      state.entries[key] = next
      return {
        key,
        repo: update.repo,
        dependency: update.dependency,
        targetMinor: update.targetMinor,
        targetVersion: update.targetVersion,
        outcome,
        handledCount: next.handledCount,
        prNumber: next.prNumber,
        note: next.note,
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
      handledEntries: entries.filter((entry) => entry.lastHandledOutcome !== null).length,
      openedEntries: entries.filter((entry) => entry.lastHandledOutcome === 'opened').length,
      updatedAt: state.updatedAt,
    }
  })
  return {
    content: [
      {
        type: 'text',
        text: `ledger entries=${summary.totalEntries} handled=${summary.handledEntries} opened=${summary.openedEntries}`,
      },
    ],
    details: summary,
  }
}

export default function registerDependencyUpdateLedgerTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'dependency_update_ledger',
    label: 'dependency update ledger',
    description:
      'Persist cross-run dependency minor update handling state outside chat memory. Use check before opening a PR and record after opening or suppressing that minor.',
    parameters: dependencyUpdateSchema,
    execute: async (_toolCallId, input: DependencyUpdateLedgerInput) => {
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

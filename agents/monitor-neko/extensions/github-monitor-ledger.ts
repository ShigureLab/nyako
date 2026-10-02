import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const RETENTION_MS = 45 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 5000

const EXACT_EVENT_ALIASES = {
  comment: ['comment', 'issue_comment'],
  review: ['review', 'pull_review', 'pull_request_review'],
  'review-comment': ['review_comment', 'pull_review_comment', 'pull_request_review_comment'],
  'review-request': [
    'review_request',
    'review_requested',
    'review_requested_event',
    'graphql_review_requested_event',
    'pull_request_review_request',
  ],
  'issue-event': [
    'issue_event',
    'pull_request_event',
    'pull_request',
    'assigned',
    'unassigned',
    'renamed',
    'merged',
    'closed',
    'reopened',
    'pull_request_merged',
    'pull_request_closed',
    'pull_request_merged_event',
    'pr_merged_event',
    'graphql_merged_event',
    'issue_event_merged',
  ],
  'check-run': ['check_run'],
  'check-suite': ['check_suite'],
} as const

const EXACT_EVENT_KINDS = new Map<string, string>(
  Object.entries(EXACT_EVENT_ALIASES).flatMap(([kind, aliases]) =>
    aliases.map((alias) => [alias, kind] as const)
  )
)

const outcomeSchema = Type.Union([Type.Literal('routed'), Type.Literal('suppressed')])
const stateSchema = Type.Object(
  {
    headSha: Type.Optional(
      Type.String({ pattern: '^[0-9a-fA-F]{40}$', description: 'Full commit SHA.' })
    ),
    lifecycle: Type.Optional(
      Type.Union([Type.Literal('open'), Type.Literal('merged'), Type.Literal('closed')])
    ),
    failureFingerprint: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          'Validated stable CI root cause. Exclude check display names, run ids, timestamps, and log line numbers.',
      })
    ),
    gate: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          'Explicit non-CI blocker, such as approval. Use separately from failureFingerprint.',
      })
    ),
  },
  { additionalProperties: false }
)
const sourceEventSchema = Type.Object(
  {
    type: Type.String({
      minLength: 1,
      description:
        'GitHub event type, optionally prefixed with github. New types are accepted. For issue/PR timeline events use the event id, never the issue/PR number.',
    }),
    id: Type.Union([Type.String({ minLength: 1 }), Type.Integer({ minimum: 1 })]),
    url: Type.Optional(Type.String()),
    actorLogin: Type.Optional(Type.String()),
    body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
)
const eventSchema = Type.Object(
  {
    sourceEvent: Type.Optional(sourceEventSchema),
    eventKey: Type.Optional(
      Type.String({
        pattern: '^github:thread:[0-9]+$',
        description:
          'Current unread notification key, only for synthetic state. Omit for sourceEvent.',
      })
    ),
    state: Type.Optional(stateSchema),
    outcome: Type.Optional(outcomeSchema),
  },
  { additionalProperties: false }
)
const inputSchema = Type.Object(
  {
    action: Type.Union([Type.Literal('check'), Type.Literal('record'), Type.Literal('stats')]),
    events: Type.Optional(Type.Array(eventSchema, { minItems: 1 })),
  },
  { additionalProperties: false }
)

const entrySchema = Type.Object(
  {
    lastSeenAt: Type.Integer({ minimum: 0 }),
    handled: Type.Optional(
      Type.Object(
        {
          fingerprint: Type.Union([Type.String(), Type.Null()]),
          outcome: outcomeSchema,
          at: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
)
const ledgerSchema = Type.Object(
  {
    version: Type.Literal(2),
    entries: Type.Record(Type.String(), entrySchema),
  },
  { additionalProperties: false }
)
type Ledger = Static<typeof ledgerSchema>
type Input = Static<typeof inputSchema>

function normalizeEvent(event: Static<typeof eventSchema>) {
  if (event.sourceEvent) {
    if (event.eventKey || event.state) {
      throw new Error('Exact events use only sourceEvent; omit eventKey and state')
    }
    const type = event.sourceEvent.type
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/^github[.:/_-]+/, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    const id = String(event.sourceEvent.id).trim()
    if (!type || !id) throw new Error('sourceEvent.type and sourceEvent.id must be non-empty')
    return { key: `github:event:${EXACT_EVENT_KINDS.get(type) ?? type}:${id}`, fingerprint: null }
  }
  if (!event.eventKey || !event.state) {
    throw new Error('Synthetic events require eventKey and structured state')
  }
  const { lifecycle } = event.state
  const headSha = event.state.headSha?.toLowerCase()
  const failureFingerprint = event.state.failureFingerprint
    ?.trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
  const gate = event.state.gate?.trim().toLowerCase()
  if (failureFingerprint && gate) throw new Error('Use either failureFingerprint or gate')
  const state =
    lifecycle === 'merged' || lifecycle === 'closed'
      ? { lifecycle }
      : failureFingerprint
        ? { headSha, failureFingerprint }
        : gate
          ? { headSha, gate }
          : { headSha, lifecycle }
  const fingerprint = JSON.stringify(state)
  if (fingerprint === '{}') throw new Error('Synthetic state must contain actionable facts')
  return { key: event.eventKey, fingerprint }
}

function ledgerLocation() {
  const projectRoot = realpathSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  )
  const slug = path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]+/g, '_')
  const hash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 12)
  const dir = path.join(os.homedir(), '.nyakore/integrations/github-monitor', `${slug}-${hash}`)
  return { dir, file: path.join(dir, 'ledger.json'), lock: path.join(dir, 'ledger.lock') }
}

async function readLedger(file: string): Promise<Ledger> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, entries: {} }
    throw error
  }
  const ledger: unknown = JSON.parse(raw)
  if (!Value.Check(ledgerSchema, ledger)) throw new Error(`Invalid ledger v2: ${file}`)
  return ledger
}

async function acquireLock(lock: string) {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      await mkdir(lock)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error(`github monitor ledger lock timed out: ${lock}`)
      await delay(50)
    }
  }
}

async function executeLedger(input: Input) {
  if (!Value.Check(inputSchema, input)) throw new Error('Invalid github_monitor_ledger arguments')
  const location = ledgerLocation()
  if (input.action === 'stats') {
    const entries = Object.values((await readLedger(location.file)).entries)
    return {
      ledgerPath: location.file,
      totalEntries: entries.length,
      handledEntries: entries.filter((entry) => entry.handled).length,
    }
  }
  if (!input.events?.length) throw new Error('check and record require non-empty events')
  const events = input.events.map((event) => {
    if (input.action === 'record' && !event.outcome) throw new Error('record requires outcome')
    return { ...normalizeEvent(event), outcome: event.outcome }
  })
  await mkdir(location.dir, { recursive: true })
  await acquireLock(location.lock)
  try {
    const ledger = await readLedger(location.file)
    const now = Date.now()
    ledger.entries = Object.fromEntries(
      Object.entries(ledger.entries).filter(([, entry]) => entry.lastSeenAt >= now - RETENTION_MS)
    )
    const results = events.map(({ key, fingerprint, outcome }) => {
      const entry = ledger.entries[key] ?? { lastSeenAt: now }
      const shouldAct = !entry.handled || entry.handled.fingerprint !== fingerprint
      if (input.action === 'record' && (shouldAct || entry.handled?.outcome !== outcome)) {
        entry.handled = { fingerprint, outcome: outcome!, at: now }
      }
      entry.lastSeenAt = now
      ledger.entries[key] = entry
      return input.action === 'check'
        ? { eventKey: key, shouldAct }
        : { eventKey: key, outcome: entry.handled!.outcome }
    })
    ledger.entries = Object.fromEntries(
      Object.entries(ledger.entries)
        .sort(([, left], [, right]) => right.lastSeenAt - left.lastSeenAt)
        .slice(0, MAX_ENTRIES)
    )
    const temp = `${location.file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    await rename(temp, location.file)
    return results
  } finally {
    await rm(location.lock, { recursive: true, force: true })
  }
}

export default function registerGithubMonitorLedgerTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'github_monitor_ledger',
    label: 'github monitor ledger',
    description:
      'Deduplicate GitHub events across runs. Exact events use sourceEvent type + id. Synthetic state uses the current unread github:thread:<thread_id> with state; comments/reviews always use their own sourceEvent. Check first, then record only after successful routing or intentional suppression. Reuse the same input identity/state for check and record. stats is read-only.',
    parameters: inputSchema,
    execute: async (_toolCallId, input: Input) => {
      const result = await executeLedger(input)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { action: input.action, result },
      }
    },
  })
}

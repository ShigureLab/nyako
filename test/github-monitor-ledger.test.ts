import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import registerGithubMonitorLedgerTool from '../agents/monitor-neko/extensions/github-monitor-ledger.ts'

type Tool = { execute: (id: string, input: unknown) => Promise<any> }
function registerTool(): Tool {
  let tool!: Tool
  registerGithubMonitorLedgerTool({
    registerTool(value: Tool) {
      tool = value
    },
  } as unknown as ExtensionAPI)
  return tool
}

const sourceEvent = { type: 'issue_comment', id: 101 }
const eventKey = 'github:thread:123'
const headSha = '1234567890abcdef1234567890abcdef12345678'

describe('github-monitor-ledger', () => {
  let tempHome: string
  let tool: Tool
  let ledgerPath: string
  const call = async (action: string, events?: unknown[]) =>
    JSON.parse((await tool.execute('test', { action, events })).content[0].text)
  const read = async () => JSON.parse(await readFile(ledgerPath, 'utf8'))

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), 'nyako-ledger-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
    tool = registerTool()
    ledgerPath = (await call('stats')).ledgerPath
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tempHome, { recursive: true, force: true })
  })

  it('keeps checks retryable, then persists exact-event handling across tool instances', async () => {
    for (let i = 0; i < 2; i++)
      expect((await call('check', [{ sourceEvent }]))[0].shouldAct).toBe(true)
    await call('record', [{ sourceEvent, outcome: 'routed' }])
    tool = registerTool()
    const results = await call('check', [
      { sourceEvent: { ...sourceEvent, type: 'github.comment', body: 'edited' } },
      { sourceEvent: { ...sourceEvent, id: 102 } },
    ])
    expect(results.map((result: any) => result.shouldAct)).toEqual([false, true])
  })

  it.each([
    ['github.assigned', 'issue_event'],
    ['assigned', 'github.issue_event'],
    ['renamed', 'issue_event'],
    ['closed', 'issue_event'],
    ['merged', 'issue_event'],
    ['pull_request', 'issue_event'],
    ['pull_request_event', 'issue_event'],
    ['pull_request_closed', 'issue_event'],
    ['pull_request_merged', 'issue_event'],
    ['pull_request_merged_event', 'issue_event'],
    ['github.pr_merged_event', 'issue_event'],
    ['github.graphql_merged_event', 'issue_event'],
    ['github.issue_event.merged', 'issue_event'],
    ['github.graphql_review_requested_event', 'review_requested'],
    ['check_run', 'github.check_run'],
    ['check_suite', 'github.check_suite'],
    ['labeled', 'github.labeled'],
  ])('deduplicates %s and %s by event identity', async (type, alias) => {
    const event = { sourceEvent: { type, id: 201, body: null } }
    expect((await call('check', [event]))[0].shouldAct).toBe(true)
    await call('record', [{ ...event, outcome: 'suppressed' }])
    expect((await call('check', [{ sourceEvent: { type: alias, id: '201' } }]))[0].shouldAct).toBe(
      false
    )
  })

  it('keeps unrelated event namespaces separate within a batch', async () => {
    const events = ['issue_comment', 'pull_request_review', 'check_run', 'merged'].map((type) => ({
      sourceEvent: { type, id: 202 },
    }))
    await call('record', [{ ...events[0], outcome: 'routed' }])
    const results = await call('check', events)
    expect(new Set(results.map((result: any) => result.eventKey)).size).toBe(4)
    expect(results.map((result: any) => result.shouldAct)).toEqual([false, true, true, true])
  })

  it('compares normalized CI facts and keeps new causes or commits actionable', async () => {
    const state = { headSha, failureFingerprint: 'Compiler error' }
    await call('record', [{ eventKey, state, outcome: 'routed' }])
    const results = await call('check', [
      {
        eventKey,
        state: {
          ...state,
          lifecycle: 'open',
          headSha: headSha.toUpperCase(),
          failureFingerprint: ' compiler  ERROR ',
        },
      },
      { eventKey, state: { ...state, failureFingerprint: 'missing library' } },
      { eventKey, state: { ...state, headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
      { eventKey, state: { headSha, gate: 'approval' } },
    ])
    expect(results.map((result: any) => result.shouldAct)).toEqual([false, true, true, true])
  })

  it.each(['merged', 'closed'])(
    'deduplicates %s lifecycle independently of head and comments',
    async (lifecycle) => {
      await call('record', [{ eventKey, state: { lifecycle, headSha }, outcome: 'routed' }])
      const results = await call('check', [
        { eventKey, state: { lifecycle } },
        { eventKey, state: { lifecycle: 'open', headSha } },
        { sourceEvent },
      ])
      expect(results.map((result: any) => result.shouldAct)).toEqual([false, true, true])
    }
  )

  it('treats duplicate records idempotently and records a later explicit outcome', async () => {
    const event = { sourceEvent, outcome: 'suppressed' }
    await call('record', [event])
    const handled = (await read()).entries['github:event:comment:101'].handled
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await call('record', [event])
    expect((await read()).entries['github:event:comment:101'].handled).toEqual(handled)
    await call('record', [{ ...event, outcome: 'routed' }])
    expect((await read()).entries['github:event:comment:101'].handled.outcome).toBe('routed')
  })

  it.each([
    ['check', []],
    ['check', [{ sourceEvent: { type: ' ', id: 1 } }]],
    ['check', [{ sourceEvent, state: { headSha } }]],
    ['check', [{ eventKey, state: { headSha: '1234567' } }]],
    ['check', [{ eventKey, state: {} }]],
    ['check', [{ eventKey, state: { failureFingerprint: 'root', gate: 'approval' } }]],
    ['check', [{ eventKey: 'github:session-pr:old', state: { headSha } }]],
    ['check', [{ eventKey, stateDigest: 'head=abc' }]],
    ['record', [{ sourceEvent, outcome: 'routed' }, { sourceEvent: { ...sourceEvent, id: 102 } }]],
  ])('rejects invalid %s batches without a partial write: %j', async (action, events) => {
    await call('record', [{ sourceEvent, outcome: 'routed' }])
    const before = await readFile(ledgerPath, 'utf8')
    await expect(call(action, events)).rejects.toThrow()
    expect(await readFile(ledgerPath, 'utf8')).toBe(before)
  })

  it('reads stats without creating or rewriting the ledger', async () => {
    await expect(readFile(ledgerPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await call('record', [{ sourceEvent, outcome: 'routed' }])
    const before = await readFile(ledgerPath, 'utf8')
    expect(await call('stats')).toMatchObject({ totalEntries: 1, handledEntries: 1 })
    expect(await readFile(ledgerPath, 'utf8')).toBe(before)
  })

  it('expires old entries and bounds the ledger while retaining recently seen records', async () => {
    const now = Date.now()
    const entries = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [
        `github:event:comment:${i}`,
        { lastSeenAt: now - i - 1000 },
      ])
    )
    entries['github:event:comment:expired'] = { lastSeenAt: now - 46 * 86400000 }
    await mkdir(path.dirname(ledgerPath), { recursive: true })
    await writeFile(ledgerPath, JSON.stringify({ version: 2, entries }))
    await call('record', [{ sourceEvent: { type: 'issue_comment', id: 6000 }, outcome: 'routed' }])
    const persisted = (await read()).entries
    expect(Object.keys(persisted)).toHaveLength(5000)
    expect(persisted['github:event:comment:6000'].handled.outcome).toBe('routed')
    expect(persisted['github:event:comment:expired']).toBeUndefined()
    expect(persisted['github:event:comment:4999']).toBeUndefined()
  })

  it.each([
    '{broken',
    '{"version":1,"entries":{}}',
    '{"version":2,"entries":{"bad":{"lastSeenAt":"oops"}}}',
  ])('fails without overwriting invalid persisted state %s', async (contents) => {
    await mkdir(path.dirname(ledgerPath), { recursive: true })
    await writeFile(ledgerPath, contents)
    await expect(call('check', [{ sourceEvent }])).rejects.toThrow()
    expect(await readFile(ledgerPath, 'utf8')).toBe(contents)
    await expect(
      readFile(path.join(path.dirname(ledgerPath), 'ledger.lock'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

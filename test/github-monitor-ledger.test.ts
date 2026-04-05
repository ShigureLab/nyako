import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import registerGithubMonitorLedgerTool from '../tools/github-monitor-ledger/main.ts'

type RegisteredTool = {
  name: string
  execute: (toolCallId: string, input: unknown) => Promise<any>
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function registerTool(): RegisteredTool {
  let registeredTool: RegisteredTool | undefined
  const api = {
    registerTool(tool: RegisteredTool) {
      registeredTool = tool
    },
  } as unknown as ExtensionAPI

  registerGithubMonitorLedgerTool(api)

  if (!registeredTool) {
    throw new Error('github_monitor_ledger was not registered')
  }

  return registeredTool
}

describe('github-monitor-ledger tool', () => {
  let tempHome: string
  const originalHome = process.env.HOME

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), 'nyako-ledger-home-'))
    process.env.HOME = tempHome
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempHome, { recursive: true, force: true })
  })

  it('tracks new, handled, and changed notification state across runs', async () => {
    const tool = registerTool()

    const firstCheck = await tool.execute('call_1', {
      action: 'check',
      selfLogins: ['swgu98'],
      events: [
        {
          eventKey: 'repo:1#thread:abc',
          stateDigest: 'review=requested|ci=pending',
          actorLogin: 'someone',
        },
      ],
    })

    expect(firstCheck.details.results[0]).toMatchObject({
      seenStatus: 'new',
      handledStatus: 'unhandled',
      shouldAct: true,
      isSelfAuthored: false,
    })

    const record = await tool.execute('call_2', {
      action: 'record',
      selfLogins: ['swgu98'],
      events: [
        {
          eventKey: 'repo:1#thread:abc',
          stateDigest: 'review=requested|ci=pending',
          actorLogin: 'someone',
          outcome: 'routed',
          targetSessionId: 'sess_monitor_neko_github_watch',
          messageKind: 'inform',
          intent: 'github.notification.pr_review',
        },
      ],
    })

    expect(record.details.results[0]).toMatchObject({
      handledStatus: 'unhandled',
      handledCount: 1,
      outcome: 'routed',
    })

    const secondCheck = await tool.execute('call_3', {
      action: 'check',
      selfLogins: ['swgu98'],
      events: [
        {
          eventKey: 'repo:1#thread:abc',
          stateDigest: 'review=requested|ci=pending',
          actorLogin: 'someone',
        },
        {
          eventKey: 'repo:1#thread:abc',
          stateDigest: 'review=changes_requested|ci=failure',
          actorLogin: 'swgu98',
        },
      ],
    })

    expect(secondCheck.details.results[0]).toMatchObject({
      seenStatus: 'seen_repeat',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
    expect(secondCheck.details.results[1]).toMatchObject({
      seenStatus: 'seen_changed',
      handledStatus: 'handled_changed',
      shouldAct: true,
      isSelfAuthored: true,
    })

    const stats = await tool.execute('call_4', { action: 'stats' })
    expect(stats.details).toMatchObject({
      projectRoot: repoRoot,
      handledEntries: 1,
      totalEntries: 1,
    })

    const ledgerPath = secondCheck.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      projectRoot: string
      entries: Record<
        string,
        {
          lastHandledOutcome: string | null
          targetSessionId: string | null
        }
      >
    }

    expect(ledger.projectRoot).toBe(repoRoot)
    expect(ledger.entries['repo:1#thread:abc']).toMatchObject({
      lastHandledOutcome: 'routed',
      targetSessionId: 'sess_monitor_neko_github_watch',
    })
  })
})

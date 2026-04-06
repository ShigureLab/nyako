import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import registerDependencyUpdateLedgerTool from '../tools/dependency-update-ledger/main.ts'

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

  registerDependencyUpdateLedgerTool(api)

  if (!registeredTool) {
    throw new Error('dependency_update_ledger was not registered')
  }

  return registeredTool
}

describe('dependency-update-ledger tool', () => {
  let tempHome: string
  const originalHome = process.env.HOME

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), 'nyako-dependency-ledger-home-'))
    process.env.HOME = tempHome
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempHome, { recursive: true, force: true })
  })

  it('deduplicates repeated patch releases within one handled minor', async () => {
    const tool = registerTool()

    const firstCheck = await tool.execute('call_1', {
      action: 'check',
      updates: [
        {
          repo: 'PaddlePaddle/Paddle',
          dependency: 'ruff',
          targetMinor: '0.13',
          targetVersion: '0.13.0',
        },
      ],
    })

    expect(firstCheck.details.results[0]).toMatchObject({
      seenStatus: 'new',
      handled: false,
      shouldAct: true,
    })

    const secondCheck = await tool.execute('call_2', {
      action: 'check',
      updates: [
        {
          repo: 'PaddlePaddle/Paddle',
          dependency: 'ruff',
          targetMinor: '0.13',
          targetVersion: '0.13.2',
        },
      ],
    })

    expect(secondCheck.details.results[0]).toMatchObject({
      seenStatus: 'seen_version_changed',
      handled: false,
      shouldAct: true,
    })

    const record = await tool.execute('call_3', {
      action: 'record',
      updates: [
        {
          repo: 'PaddlePaddle/Paddle',
          dependency: 'ruff',
          targetMinor: '0.13',
          targetVersion: '0.13.2',
          outcome: 'opened',
          prNumber: 12345,
          note: 'opened weekly tooling bump',
        },
      ],
    })

    expect(record.details.results[0]).toMatchObject({
      outcome: 'opened',
      handledCount: 1,
      prNumber: 12345,
    })

    const thirdCheck = await tool.execute('call_4', {
      action: 'check',
      updates: [
        {
          repo: 'PaddlePaddle/Paddle',
          dependency: 'ruff',
          targetMinor: '0.13',
          targetVersion: '0.13.5',
        },
      ],
    })

    expect(thirdCheck.details.results[0]).toMatchObject({
      seenStatus: 'seen_version_changed',
      handled: true,
      shouldAct: false,
      lastHandledOutcome: 'opened',
      lastHandledVersion: '0.13.2',
      prNumber: 12345,
    })

    const newMinorCheck = await tool.execute('call_5', {
      action: 'check',
      updates: [
        {
          repo: 'PaddlePaddle/Paddle',
          dependency: 'ruff',
          targetMinor: '0.14',
          targetVersion: '0.14.0',
        },
      ],
    })

    expect(newMinorCheck.details.results[0]).toMatchObject({
      seenStatus: 'new',
      handled: false,
      shouldAct: true,
    })

    const stats = await tool.execute('call_6', { action: 'stats' })
    expect(stats.details).toMatchObject({
      projectRoot: repoRoot,
      totalEntries: 2,
      handledEntries: 1,
      openedEntries: 1,
    })

    const ledgerPath = thirdCheck.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      projectRoot: string
      entries: Record<
        string,
        {
          lastHandledOutcome: string | null
          lastHandledVersion: string | null
          prNumber: number | null
        }
      >
    }

    expect(ledger.projectRoot).toBe(repoRoot)
    expect(ledger.entries['paddlepaddle/paddle#ruff#0.13']).toMatchObject({
      lastHandledOutcome: 'opened',
      lastHandledVersion: '0.13.2',
      prNumber: 12345,
    })
  })
})

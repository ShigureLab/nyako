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

  it('canonicalizes GitHub notification thread key aliases', async () => {
    const tool = registerTool()

    const firstCheck = await tool.execute('call_1', {
      action: 'check',
      events: [
        {
          eventKey: 'github:notification:23960089331',
          stateDigest: 'ci=failure|head=abc|failed=Check PR Template',
        },
      ],
    })

    expect(firstCheck.details.results[0]).toMatchObject({
      eventKey: 'github:thread:23960089331',
      seenStatus: 'new',
      shouldAct: true,
    })

    await tool.execute('call_2', {
      action: 'record',
      events: [
        {
          eventKey: 'github-notification:23960089331:thread',
          stateDigest: 'ci=failure|head=abc|failed=Check PR Template',
          outcome: 'routed',
        },
      ],
    })

    const secondCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'gh-thread:23960089331:ci_activity:PaddlePaddle/Paddle',
          stateDigest: 'ci=failure|head=abc|failed=Check PR Template',
        },
      ],
    })

    expect(secondCheck.details.results[0]).toMatchObject({
      eventKey: 'github:thread:23960089331',
      seenStatus: 'seen_repeat',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const ledgerPath = secondCheck.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<string, unknown>
    }

    expect(Object.keys(ledger.entries)).toEqual(['github:thread:23960089331'])
  })

  it('auto-suppresses configured Paddle bot events as ignored actors', async () => {
    const tool = registerTool()

    const firstCheck = await tool.execute('call_1', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:30001',
          stateDigest: 'review=commented|comment=bot-review-1',
          actorLogin: 'PaddlePaddle-bot',
        },
      ],
    })

    expect(firstCheck.details.results[0]).toMatchObject({
      eventKey: 'github:thread:30001',
      actorLogin: 'paddlepaddle-bot',
      isIgnoredActor: true,
      shouldAct: false,
      lastHandledOutcome: 'suppressed',
      handledCount: 1,
    })

    const secondCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:notification:30001',
          stateDigest: 'review=commented|comment=bot-review-1',
          actorLogin: 'PaddlePaddle-bot',
        },
      ],
    })

    expect(secondCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      isIgnoredActor: true,
      shouldAct: false,
      handledCount: 1,
    })

    const ledgerPath = secondCheck.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<
        string,
        {
          isIgnoredActor: boolean
          lastHandledOutcome: string | null
          intent: string | null
        }
      >
    }

    expect(ledger.entries['github:thread:30001']).toMatchObject({
      isIgnoredActor: true,
      lastHandledOutcome: 'suppressed',
      intent: 'github.notification.ignored_actor',
    })

    const ciBotCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:30002',
          stateDigest: 'ci=commented|comment=bot-status-1',
          actorLogin: 'Paddle-CI-Bot',
        },
      ],
    })

    expect(ciBotCheck.details.results[0]).toMatchObject({
      eventKey: 'github:thread:30002',
      actorLogin: 'paddle-ci-bot',
      isIgnoredActor: true,
      shouldAct: false,
      lastHandledOutcome: 'suppressed',
      handledCount: 1,
    })
  })

  it('canonicalizes session PR state key aliases', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'session-pr:sess_dev:PaddlePaddle/Paddle#79104',
          stateDigest: 'head=abc|review=required|ci=failed:Check approval',
          outcome: 'routed',
        },
      ],
    })

    const check = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:session-pr-state:sess_dev:PaddlePaddle/Paddle:79104',
          stateDigest: 'head=abc|review=required|ci=failed:Check approval',
        },
      ],
    })

    expect(check.details.results[0]).toMatchObject({
      eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79104',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('canonicalizes noisy CI state digests before deciding whether to route', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'session-pr:sess_dev:PaddlePaddle/Paddle#79107',
          stateDigest:
            'repo:PaddlePaddle/Paddle#79107;head:d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state:open;merged:false;review:REVIEW_REQUIRED;latest_event:push:d84bac1eda8eff12145d5ef9781d5e2fef1f1484;failed_checks:Slice / Slice test|Approval/Check approval|Coverage test',
          outcome: 'routed',
        },
      ],
    })

    const repeatCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:session-pr-state:sess_dev:PaddlePaddle/Paddle:79107',
          stateDigest:
            'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=OPEN;review=REVIEW_REQUIRED;failed=Coverage test|Check approval|Slice / Slice test',
        },
      ],
    })

    expect(repeatCheck.details.results[0]).toMatchObject({
      eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79107',
      stateDigest:
        'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=open;review=review_required;failed=check approval|coverage test|slice / slice test',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const newCommentCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79107',
          stateDigest:
            'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=OPEN;review=REVIEW_REQUIRED;failed=Coverage test|Check approval|Slice / Slice test;comment=gouzil:4582462739',
        },
      ],
    })

    expect(newCommentCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_changed',
      shouldAct: true,
    })
  })

  it('builds stable fingerprints from structured state facts', async () => {
    const tool = registerTool()
    const headSha = 'd84bac1eda8eff12145d5ef9781d5e2fef1f1484'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'session-pr:sess_dev:PaddlePaddle/Paddle#79107',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79107,
            headSha,
            state: 'OPEN',
            merged: false,
            reviewDecision: 'REVIEW_REQUIRED',
            failedChecks: ['Slice / Slice test', 'Approval/Check approval', 'Coverage test'],
          },
          outcome: 'routed',
        },
      ],
    })

    const repeatCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:session-pr-state:sess_dev:PaddlePaddle/Paddle:79107',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: '79107',
            headSha: headSha.toUpperCase(),
            state: 'open',
            reviewDecision: 'review_required',
            failedChecks: ['Coverage test', 'Check approval', 'Slice / Slice test'],
          },
        },
      ],
    })

    expect(repeatCheck.details.results[0]).toMatchObject({
      eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79107',
      stateDigest:
        'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=open;review=review_required;failed=check approval|coverage test|slice / slice test',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const newCommentCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79107',
          state: {
            headSha,
            state: 'OPEN',
            reviewDecision: 'REVIEW_REQUIRED',
            latestCommentId: 'gouzil:4582462739',
            failedChecks: ['Coverage test', 'Check approval', 'Slice / Slice test'],
          },
        },
      ],
    })

    expect(newCommentCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_changed',
      shouldAct: true,
    })
  })

  it('treats repeated merged PR backchecks as terminal no-op state', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79119',
          stateDigest:
            'repo=PaddlePaddle/Paddle;pr=79119;head=50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90;merged=true;review=APPROVED;failed=Linux-DCU / Test',
          outcome: 'routed',
        },
      ],
    })

    const check = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'session-pr:sess_dev:PaddlePaddle/Paddle#79119',
          stateDigest:
            'head:50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90;state:MERGED;review:APPROVED;failed_checks:Check approval|Coverage test',
        },
      ],
    })

    expect(check.details.results[0]).toMatchObject({
      stateDigest: 'terminal=merged;head=50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90;review=approved',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('matches structured terminal state against legacy digest records', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79119',
          stateDigest:
            'repo=PaddlePaddle/Paddle;pr=79119;head=50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90;merged=true;review=APPROVED;failed=Linux-DCU / Test',
          outcome: 'routed',
        },
      ],
    })

    const check = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'session-pr:sess_dev:PaddlePaddle/Paddle#79119',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79119,
            headSha: '50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90',
            terminal: 'merged',
            reviewDecision: 'APPROVED',
            failedChecks: ['Check approval', 'Coverage test'],
          },
        },
      ],
    })

    expect(check.details.results[0]).toMatchObject({
      stateDigest: 'terminal=merged;head=50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90;review=approved',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('does not inflate handled count for duplicate records', async () => {
    const tool = registerTool()
    const event = {
      eventKey: 'github:session-pr:sess_dev:PaddlePaddle/Paddle#79082',
      stateDigest: 'head=647a7c539c58a29ff053de3397ddc5c56defd348;merged=true',
      outcome: 'routed',
    }

    const firstRecord = await tool.execute('call_1', {
      action: 'record',
      events: [event],
    })
    const secondRecord = await tool.execute('call_2', {
      action: 'record',
      events: [event],
    })

    expect(firstRecord.details.results[0]).toMatchObject({
      handledCount: 1,
    })
    expect(secondRecord.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      handledCount: 1,
    })
  })
})

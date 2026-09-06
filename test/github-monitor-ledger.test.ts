import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import registerGithubMonitorLedgerTool from '../agents/monitor-neko/extensions/github-monitor-ledger.ts'

type RegisteredTool = {
  name: string
  parameters: TSchema
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
          eventKey: 'github:thread:30001',
          stateDigest: 'review=requested|ci=pending',
          actorLogin: 'someone',
        },
      ],
    })

    expect(JSON.parse(firstCheck.content[0].text)[0]).toMatchObject({
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
          eventKey: 'github:thread:30001',
          stateDigest: 'review=requested|ci=pending',
          actorLogin: 'someone',
          outcome: 'routed',
          targetSessionId: 'sess_monitor_neko_github_watch',
          messageKind: 'inform',
          intent: 'github.notification.pr_review',
        },
      ],
    })

    expect(JSON.parse(record.content[0].text)[0]).toMatchObject({
      handledStatus: 'unhandled',
      handledCount: 1,
      outcome: 'routed',
    })

    const secondCheck = await tool.execute('call_3', {
      action: 'check',
      selfLogins: ['swgu98'],
      events: [
        {
          eventKey: 'github:thread:30001',
          stateDigest: 'review=requested|ci=pending',
          actorLogin: 'someone',
        },
        {
          eventKey: 'github:thread:30001',
          stateDigest: 'review=changes_requested|ci=failure',
          actorLogin: 'swgu98',
        },
      ],
    })

    const decisions = JSON.parse(secondCheck.content[0].text)
    expect(decisions[0]).toMatchObject({
      seenStatus: 'seen_repeat',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
    expect(decisions[1]).toMatchObject({
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
    expect(ledger.entries['github:thread:30001']).toMatchObject({
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

  it('derives exact-event identity from sourceEvent and merges legacy key aliases', async () => {
    const tool = registerTool()
    const initialStats = await tool.execute('call_1', { action: 'stats' })
    const ledgerPath = initialStats.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      projectId: string
      projectRoot: string
      updatedAt: string
      version: number
      entries: Record<string, unknown>
    }
    const now = new Date().toISOString()
    const legacyEntry = (eventKey: string, stateDigest: string) => ({
      eventKey,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSeenDigest: stateDigest,
      seenCount: 1,
      actorLogin: 'gouzil',
      requestedReviewerLogin: null,
      isSelfAuthored: false,
      lastHandledAt: now,
      lastHandledDigest: stateDigest,
      lastHandledOutcome: 'routed',
      handledCount: 1,
      targetSessionId: 'hub_neko',
      messageKind: 'inform',
      intent: 'github.notification.event',
    })
    const commentId = '5141348316'
    const reviewId = '4814676539'
    const commentAliases = [
      `github:comment:PaddlePaddle/Paddle:79567:${commentId}`,
      `github:issue_comment:PaddlePaddle/Paddle:79567:${commentId}`,
      `github.issue_comment:PaddlePaddle/Paddle:79567:${commentId}`,
      `github.issue_comment:${commentId}`,
    ]
    const reviewAliases = [
      `github.pull_review:${reviewId}`,
      `review:PaddlePaddle/Paddle:79421:${reviewId}`,
      `github:pr:PaddlePaddle/Paddle:79421:review:${reviewId}`,
      `github:PaddlePaddle/Paddle:pull:79421:review:${reviewId}`,
    ]

    ledger.entries = Object.fromEntries([
      ...commentAliases.map((eventKey, index) => [
        eventKey,
        legacyEntry(
          eventKey,
          `head=${index === 0 ? '212fd32dd2e2' : '212fd32dd2e2fa02e030325729d98070a1250302'};state=open;comment=${commentId}`
        ),
      ]),
      ...reviewAliases.map((eventKey, index) => [
        eventKey,
        legacyEntry(
          eventKey,
          `head=${index === 0 ? '1b0651c20fb0' : '88c42745f77a5344e523ea1211a5892048c8ea61'};state=open;review=changes_requested;latest_review=${reviewId}`
        ),
      ]),
    ])
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

    const migratedStats = await tool.execute('call_2', { action: 'stats' })
    expect(migratedStats.details).toMatchObject({
      totalEntries: 2,
      handledEntries: 2,
    })

    const repeat = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          sourceEvent: {
            type: 'github.issue_comment',
            id: commentId,
            actorLogin: 'gouzil',
          },
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79567,
            headSha: 'ffffffffffffffffffffffffffffffffffffffff',
            state: 'CLOSED',
          },
        },
        {
          sourceEvent: {
            type: 'PullRequestReview',
            id: reviewId,
          },
        },
      ],
    })

    expect(JSON.parse(repeat.content[0].text)).toMatchObject([
      {
        eventKey: `github:event:comment:${commentId}`,
        stateDigest: `event=comment:${commentId}`,
        handledStatus: 'handled_repeat',
        shouldAct: false,
      },
      {
        eventKey: `github:event:review:${reviewId}`,
        stateDigest: `event=review:${reviewId}`,
        handledStatus: 'handled_repeat',
        shouldAct: false,
      },
    ])

    const fresh = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          sourceEvent: {
            type: 'issue_comment',
            id: String(Number(commentId) + 1),
          },
        },
      ],
    })
    expect(fresh.details.results[0]).toMatchObject({
      eventKey: `github:event:comment:${Number(commentId) + 1}`,
      seenStatus: 'new',
      shouldAct: true,
    })

    const migratedLedger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<string, { handledCount: number }>
    }
    expect(Object.keys(migratedLedger.entries).sort()).toEqual([
      `github:event:comment:${commentId}`,
      `github:event:comment:${Number(commentId) + 1}`,
      `github:event:review:${reviewId}`,
    ])
    expect(migratedLedger.entries[`github:event:comment:${commentId}`]?.handledCount).toBe(4)
    expect(migratedLedger.entries[`github:event:review:${reviewId}`]?.handledCount).toBe(4)
  })

  it('routes each exact review-request source event once', async () => {
    const tool = registerTool()
    const firstRequestId = '28491324291'
    const secondRequestId = '28499999999'

    const firstCheck = await tool.execute('call_1', {
      action: 'check',
      events: [
        {
          sourceEvent: {
            type: 'github.graphql_review_requested_event',
            id: firstRequestId,
            actorLogin: 'SigureMo',
          },
          requestedReviewerLogin: 'ShigureNyako',
        },
      ],
    })

    expect(firstCheck.details.results[0]).toMatchObject({
      eventKey: `github:event:review-request:${firstRequestId}`,
      stateDigest: `event=review-request:${firstRequestId}`,
      actorLogin: 'siguremo',
      requestedReviewerLogin: 'shigurenyako',
      shouldAct: true,
    })

    await tool.execute('call_2', {
      action: 'record',
      events: [
        {
          sourceEvent: {
            type: 'review_requested',
            id: firstRequestId,
            actorLogin: 'SigureMo',
          },
          requestedReviewerLogin: 'ShigureNyako',
          outcome: 'routed',
          targetSessionId: 'hub_neko',
          messageKind: 'inform',
          intent: 'github.notification.new_review_request',
        },
      ],
    })

    const repeatCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          sourceEvent: {
            type: 'pull_request_review_request',
            id: firstRequestId,
          },
        },
      ],
    })

    expect(repeatCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      requestedReviewerLogin: 'shigurenyako',
      shouldAct: false,
    })

    const newRequestCheck = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          sourceEvent: {
            type: 'review_requested_event',
            id: secondRequestId,
            actorLogin: 'another-requester',
          },
          requestedReviewerLogin: 'ShigureNyako',
        },
      ],
    })

    expect(newRequestCheck.details.results[0]).toMatchObject({
      eventKey: `github:event:review-request:${secondRequestId}`,
      stateDigest: `event=review-request:${secondRequestId}`,
      handledStatus: 'unhandled',
      actorLogin: 'another-requester',
      requestedReviewerLogin: 'shigurenyako',
      shouldAct: true,
    })

    const ledgerPath = newRequestCheck.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<
        string,
        {
          actorLogin: string | null
          requestedReviewerLogin: string | null
          lastSeenDigest: string
        }
      >
    }

    expect(Object.keys(ledger.entries).sort()).toEqual([
      `github:event:review-request:${firstRequestId}`,
      `github:event:review-request:${secondRequestId}`,
    ])
    expect(ledger.entries[`github:event:review-request:${secondRequestId}`]).toMatchObject({
      actorLogin: 'another-requester',
      requestedReviewerLogin: 'shigurenyako',
      lastSeenDigest: `event=review-request:${secondRequestId}`,
    })

    await expect(
      tool.execute('call_5', {
        action: 'check',
        events: [
          {
            sourceEvent: {
              type: 'github.issue_event',
              id: '28500000000',
            },
          },
        ],
      })
    ).rejects.toThrow('does not recognize sourceEvent.type=github.issue_event')

    await expect(
      tool.execute('call_6', {
        action: 'check',
        events: [
          {
            eventKey: 'github:thread:24780207348',
            sourceEvent: { type: 'github.review_requested', id: '28500000001' },
          },
        ],
      })
    ).rejects.toThrow('exact source events must omit eventKey')
  })

  it('requires sourceEvent instead of review-request ids in synthetic state', async () => {
    const tool = registerTool()

    await expect(
      tool.execute('call_0', {
        action: 'check',
        events: [{ state: { headSha: '1eeaf99fa5d44d051d81a68c0a3b0c364d88c804' } }],
      })
    ).rejects.toThrow('synthetic events require eventKey')

    expect(
      Value.Check(tool.parameters, {
        action: 'check',
        events: [
          {
            eventKey: 'github:thread:24774562597',
            state: {
              headSha: '1eeaf99fa5d44d051d81a68c0a3b0c364d88c804',
              latestReviewRequestId: 28491324291,
            },
          },
        ],
      })
    ).toBe(false)

    await expect(
      tool.execute('call_1', {
        action: 'check',
        events: [
          {
            eventKey: 'github:thread:24774562597',
            stateDigest: 'head=1eeaf99fa5d;reviewRequestId=28491324291',
          },
        ],
      })
    ).rejects.toThrow('review requests require exact sourceEvent.type + sourceEvent.id')
  })

  it('indexes immutable events from a handled legacy thread without replaying them', async () => {
    const tool = registerTool()
    const initialStats = await tool.execute('call_1', { action: 'stats' })
    const ledgerPath = initialStats.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<string, unknown>
    }
    const eventKey = 'github:thread:24780207348'
    const reviewRequestId = '28502799575'
    const commentId = '5141348316'
    const reviewId = '4814676539'
    const now = new Date().toISOString()
    ledger.entries[eventKey] = {
      eventKey,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSeenDigest: `head=ebe3659eed512170ea3496ab40b4eac85559626d;state=open;review=approved;latest_review=${reviewId};comment=${commentId},review_request=${reviewRequestId}`,
      seenCount: 2,
      actorLogin: 'siguremo',
      requestedReviewerLogin: 'shigurenyako',
      isSelfAuthored: false,
      lastHandledAt: now,
      lastHandledDigest: `head=ebe3659eed512170ea3496ab40b4eac85559626d;state=open;review=approved;latest_review=${reviewId};comment=${commentId},review_request=${reviewRequestId}`,
      lastHandledOutcome: 'routed',
      handledCount: 1,
      targetSessionId: 'hub_neko',
      messageKind: 'inform',
      intent: 'github.notification.new_review_request',
    }
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

    const migratedStats = await tool.execute('call_2', { action: 'stats' })
    expect(migratedStats.details).toMatchObject({ totalEntries: 4, handledEntries: 4 })

    const repeat = await tool.execute('call_3', {
      action: 'check',
      events: [
        { sourceEvent: { type: 'github.review_requested', id: reviewRequestId } },
        { sourceEvent: { type: 'github.issue_comment', id: commentId } },
        { sourceEvent: { type: 'github.pull_request_review', id: reviewId } },
      ],
    })
    expect(repeat.details.results).toMatchObject([
      {
        eventKey: `github:event:review-request:${reviewRequestId}`,
        handledStatus: 'handled_repeat',
        shouldAct: false,
      },
      {
        eventKey: `github:event:comment:${commentId}`,
        handledStatus: 'handled_repeat',
        shouldAct: false,
      },
      {
        eventKey: `github:event:review:${reviewId}`,
        handledStatus: 'handled_repeat',
        shouldAct: false,
      },
    ])

    const migrated = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<
        string,
        {
          lastSeenDigest: string
          lastHandledDigest: string | null
          handledCount: number
          lastHandledOutcome: string | null
        }
      >
    }
    expect(migrated.entries[eventKey]).toMatchObject({
      lastSeenDigest: `head=ebe3659eed512170ea3496ab40b4eac85559626d;state=open;review=approved;latest_review=${reviewId};comment=${commentId}`,
      lastHandledDigest: `head=ebe3659eed512170ea3496ab40b4eac85559626d;state=open;review=approved;latest_review=${reviewId};comment=${commentId}`,
      handledCount: 1,
      lastHandledOutcome: 'routed',
    })
    for (const exactKey of [
      `github:event:review-request:${reviewRequestId}`,
      `github:event:comment:${commentId}`,
      `github:event:review:${reviewId}`,
    ]) {
      expect(migrated.entries[exactKey]).toMatchObject({
        lastSeenDigest: `event=${exactKey.split(':').slice(-2).join(':')}`,
        lastHandledDigest: `event=${exactKey.split(':').slice(-2).join(':')}`,
        handledCount: 1,
        lastHandledOutcome: 'routed',
      })
    }
  })

  it('keeps a newer legacy review request unhandled when the handled id is older', async () => {
    const tool = registerTool()
    const initialStats = await tool.execute('call_1', { action: 'stats' })
    const ledgerPath = initialStats.details.ledgerPath as string
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      entries: Record<string, unknown>
    }
    const eventKey = 'github:notification:24780207349'
    const handledId = '28502799575'
    const currentId = '28502799576'
    const now = new Date().toISOString()
    ledger.entries[eventKey] = {
      eventKey,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSeenDigest: `head=ebe3659eed512170ea3496ab40b4eac85559626d;reviewRequestId=${currentId}`,
      seenCount: 2,
      actorLogin: 'siguremo',
      requestedReviewerLogin: 'shigurenyako',
      isSelfAuthored: false,
      lastHandledAt: now,
      lastHandledDigest: `head=ebe3659eed512170ea3496ab40b4eac85559626d;review_request=${handledId}`,
      lastHandledOutcome: 'routed',
      handledCount: 1,
      targetSessionId: 'hub_neko',
      messageKind: 'inform',
      intent: 'github.notification.new_review_request',
    }
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

    const check = await tool.execute('call_2', {
      action: 'check',
      events: [
        { sourceEvent: { type: 'github.review_requested', id: handledId } },
        { sourceEvent: { type: 'github.review_requested', id: currentId } },
      ],
    })

    expect(check.details.results).toMatchObject([
      { handledStatus: 'handled_repeat', shouldAct: false },
      { handledStatus: 'unhandled', shouldAct: true },
    ])
  })

  it('keeps repeated notification thread state handled', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79104',
          stateDigest: 'head=abc|review=required|ci=failed:Check approval',
          outcome: 'routed',
        },
      ],
    })

    const check = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79104',
          stateDigest: 'head=abc|review=required|ci=failed:Check approval',
        },
      ],
    })

    expect(check.details.results[0]).toMatchObject({
      eventKey: 'github:thread:79104',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('normalizes CI state within one notification thread', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79104',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79104,
            headSha: '64dc4a69acb6559037d2c1f59bb06c96c84249d9',
            state: 'open',
            reviewDecision: 'review_required',
            failedChecks: ['Linux-CPU / Build and test'],
          },
          outcome: 'suppressed',
        },
      ],
    })

    const check = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79104',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79104,
            headSha: '64dc4a69',
            state: 'OPEN',
            reviewDecision: 'REVIEW_REQUIRED',
            failedChecks: ['Linux-CPU / Build and test'],
          },
        },
      ],
    })

    expect(check.details.results[0]).toMatchObject({
      eventKey: 'github:thread:79104',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('keeps suppressed same-head CI notifications quiet when check display sets fluctuate', async () => {
    const tool = registerTool()
    const headSha = '64dc4a69acb6559037d2c1f59bb06c96c84249d9'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79189',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79189,
            headSha,
            state: 'open',
            reviewDecision: 'review_required',
            latestCommentId: 'non_trusted_status_comment',
            failedChecks: [
              'Check approval',
              'Coverage build',
              'Linux-CPU / Build and test',
              'Slice / Slice test',
            ],
          },
          outcome: 'suppressed',
        },
      ],
    })

    const sameHeadFluctuation = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79189',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79189,
            headSha: headSha.slice(0, 8),
            state: 'OPEN',
            reviewDecision: 'REVIEW_REQUIRED',
            failedChecks: ['Coverage build', 'Linux-CPU / Build and test', 'Slice / Slice test'],
          },
        },
      ],
    })

    expect(sameHeadFluctuation.details.results[0]).toMatchObject({
      eventKey: 'github:thread:79189',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const newCommentSignal = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79189',
          state: {
            headSha,
            state: 'open',
            reviewDecision: 'review_required',
            latestCommentId: 'trusted_new_comment',
            failedChecks: ['Coverage build', 'Linux-CPU / Build and test', 'Slice / Slice test'],
          },
        },
      ],
    })

    expect(newCommentSignal.details.results[0]).toMatchObject({
      handledStatus: 'handled_changed',
      shouldAct: true,
    })
  })

  it('canonicalizes noisy CI state digests before deciding whether to route', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79107',
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
          eventKey: 'github:thread:79107',
          stateDigest:
            'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=OPEN;review=REVIEW_REQUIRED;failed=Coverage test|Check approval|Slice / Slice test',
        },
      ],
    })

    expect(repeatCheck.details.results[0]).toMatchObject({
      eventKey: 'github:thread:79107',
      stateDigest:
        'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=open;review=review_required;failed=check approval|coverage test|slice / slice test',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const newCommentCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79107',
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
          eventKey: 'github:thread:79107',
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
          eventKey: 'github:thread:79107',
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
      eventKey: 'github:thread:79107',
      stateDigest:
        'head=d84bac1eda8eff12145d5ef9781d5e2fef1f1484;state=open;review=review_required;failed=check approval|coverage test|slice / slice test',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const newCommentCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79107',
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

  it('distinguishes validated CI root causes under the same check name', async () => {
    const tool = registerTool()
    const eventKey = 'github:thread:79107'
    const headSha = 'd84bac1eda8eff12145d5ef9781d5e2fef1f1484'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey,
          state: {
            headSha,
            failedChecks: ['Linux-CPU / Build and test'],
            failureFingerprint: 'linux-cpu:compile:undefined-symbol',
          },
          outcome: 'suppressed',
        },
      ],
    })

    const changedRootCause = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            headSha,
            failedChecks: ['Linux-CPU / Build and test'],
            failureFingerprint: 'linux-cpu:test:allocator-regression',
          },
        },
      ],
    })

    expect(changedRootCause.details.results[0]).toMatchObject({
      stateDigest: `head=${headSha};failed=linux-cpu / build and test;failure=linux-cpu:test:allocator-regression`,
      handledStatus: 'handled_changed',
      shouldAct: true,
    })

    await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          eventKey,
          state: {
            headSha,
            failedChecks: ['Linux-CPU / Build and test'],
            failureFingerprint: 'linux-cpu:test:allocator-regression',
          },
          outcome: 'routed',
        },
      ],
    })

    const repeatedRootCause = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            headSha,
            failedChecks: ['Linux-CPU / Compile and test (renamed)'],
            failureFingerprint: 'LINUX-CPU:TEST:ALLOCATOR-REGRESSION',
          },
        },
      ],
    })

    expect(repeatedRootCause.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const newCommentOnSameFailure = await tool.execute('call_5', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            headSha,
            latestCommentId: 4582462739,
            failedChecks: ['Linux-CPU / Compile and test (renamed)'],
            failureFingerprint: 'linux-cpu:test:allocator-regression',
          },
        },
      ],
    })

    expect(newCommentOnSameFailure.details.results[0]).toMatchObject({
      handledStatus: 'handled_changed',
      shouldAct: true,
    })
  })

  it('uses an explicit approval gate marker instead of inferring gate checks by name', async () => {
    const tool = registerTool()
    const headSha = 'e363e34cbfda0b38828626a77e2833b6984daaba'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79329',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79329,
            headSha,
            state: 'OPEN',
            reviewDecision: 'REVIEW_REQUIRED',
            latestReviewId: 'siguremo:commented:2026-06-18t05:33:24z',
            latestCommentId: 'ic_kwdoa-qtos8aaaabgswbma',
            failedChecks: ['project-specific gate a'],
            gate: 'approval',
          },
          outcome: 'routed',
          intent: 'github.notification.ci_failure',
        },
      ],
    })

    const repeatedGateCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79329',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79329,
            headSha: headSha.slice(0, 7),
            state: 'open',
            reviewDecision: 'review_required',
            failedChecks: ['renamed gate b', 'project-specific gate a'],
            gate: 'approval',
          },
        },
      ],
    })

    expect(repeatedGateCheck.details.results[0]).toMatchObject({
      eventKey: 'github:thread:79329',
      stateDigest: `head=${headSha.slice(0, 7)};state=open;review=review_required;gate=approval`,
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    const actualFailureCheck = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79329',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79329,
            headSha,
            state: 'open',
            reviewDecision: 'review_required',
            failedChecks: ['project-specific gate a', 'Linux-CPU / Build and test'],
          },
        },
      ],
    })

    expect(actualFailureCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_changed',
      shouldAct: true,
    })
  })

  it('treats repeated merged PR notifications as terminal no-op state', async () => {
    const tool = registerTool()

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79119',
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
          eventKey: 'github:thread:79119',
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

  it('matches terminal merged digests when head SHA length changes', async () => {
    const tool = registerTool()
    const fullSha = '50ad302f5da18f8ec0debb8e9bc7dfff6e6a9c90'
    const shortSha = fullSha.slice(0, 12)

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79120',
          stateDigest: `terminal=merged;head=${shortSha};review=APPROVED`,
          outcome: 'routed',
        },
      ],
    })

    const fullCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79120',
          stateDigest: `terminal=merged;head=${fullSha};review=APPROVED`,
        },
      ],
    })

    expect(fullCheck.details.results[0]).toMatchObject({
      stateDigest: `terminal=merged;head=${fullSha};review=approved`,
      seenStatus: 'seen_repeat',
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })

    await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          eventKey: 'github:thread:79121',
          stateDigest: `terminal=merged;head=${fullSha};review=APPROVED`,
          outcome: 'routed',
        },
      ],
    })

    const shortCheck = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          eventKey: 'github:thread:79121',
          stateDigest: `terminal=merged;head=${shortSha};review=APPROVED`,
        },
      ],
    })

    expect(shortCheck.details.results[0]).toMatchObject({
      stateDigest: `terminal=merged;head=${shortSha};review=approved`,
      seenStatus: 'seen_repeat',
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
          eventKey: 'github:thread:79119',
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
          eventKey: 'github:thread:79119',
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

  it('treats a new comment on an already merged notification thread as actionable', async () => {
    const tool = registerTool()
    const eventKey = 'github:thread:24079121135'
    const headSha = 'fc5b0a279004160a05e894129d73c0c9d1a25573'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79219,
            headSha,
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
          },
          outcome: 'routed',
          intent: 'github.notification.pr_merged',
        },
      ],
    })

    const newCommentCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey,
          actorLogin: 'gouzil',
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79219,
            headSha,
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
            latestCommentId: '4639687500',
          },
        },
      ],
    })

    expect(newCommentCheck.details.results[0]).toMatchObject({
      eventKey,
      stateDigest: `terminal=merged;head=${headSha};review=approved;comment=4639687500`,
      handledStatus: 'handled_changed',
      shouldAct: true,
    })

    await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79219,
            headSha,
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
            latestCommentId: '4639687500',
          },
          outcome: 'routed',
          intent: 'github.notification.comment',
        },
      ],
    })

    const repeatCommentCheck = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79219,
            headSha: headSha.slice(0, 12),
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
            latestCommentId: '4639687500',
          },
        },
      ],
    })

    expect(repeatCommentCheck.details.results[0]).toMatchObject({
      stateDigest: `terminal=merged;head=${headSha.slice(0, 12)};review=approved;comment=4639687500`,
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('treats a new review on an already closed notification thread as actionable', async () => {
    const tool = registerTool()
    const eventKey = 'github:thread:24414707599'
    const headSha = '6591586ce6a53b2a1a52410523740c41649576f2'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey,
          actorLogin: 'SigureMo',
          state: {
            repo: 'ShigureNyako/yutto',
            pr: 2,
            headSha,
            terminal: 'closed',
            closed: true,
            merged: false,
            latestCommentId: 4835698796,
          },
          outcome: 'routed',
          intent: 'github.notification.comment',
        },
      ],
    })

    const newReviewCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey,
          actorLogin: 'SigureMo',
          state: {
            repo: 'ShigureNyako/yutto',
            pr: 2,
            headSha,
            terminal: 'closed',
            closed: true,
            merged: false,
            latestReviewId: 4594454680,
          },
        },
      ],
    })

    expect(newReviewCheck.details.results[0]).toMatchObject({
      eventKey,
      stateDigest: `terminal=closed;head=${headSha};latest_review=4594454680`,
      handledStatus: 'handled_changed',
      shouldAct: true,
    })

    await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          eventKey,
          actorLogin: 'SigureMo',
          state: {
            repo: 'ShigureNyako/yutto',
            pr: 2,
            headSha: headSha.slice(0, 12),
            terminal: 'closed',
            closed: true,
            merged: false,
            latestReviewId: 4594454680,
          },
          outcome: 'routed',
          intent: 'github.notification.pr_review',
        },
      ],
    })

    const repeatReviewCheck = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            repo: 'ShigureNyako/yutto',
            pr: 2,
            headSha,
            terminal: 'closed',
            closed: true,
            merged: false,
            latestReviewId: 4594454680,
          },
        },
      ],
    })

    expect(repeatReviewCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      shouldAct: false,
    })
  })

  it('keeps suppressed Paddle PR terminal states handled when head SHA length changes', async () => {
    const tool = registerTool()
    const eventKey = 'github:thread:79233'
    const fullSha = 'fb301d72c2725f4fcabf78c513b91a1b5b108364'
    const shortSha = 'fb301d72c272'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey,
          stateDigest: `terminal=merged;head=${shortSha}`,
          outcome: 'suppressed',
        },
      ],
    })

    const repeatCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79233,
            headSha: fullSha,
            state: 'MERGED',
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
          },
        },
      ],
    })

    expect(repeatCheck.details.results[0]).toMatchObject({
      eventKey,
      stateDigest: `terminal=merged;head=${fullSha};review=approved`,
      handledStatus: 'handled_repeat',
      shouldAct: false,
      lastHandledOutcome: 'suppressed',
      handledCount: 1,
    })

    const staleRoutedRecord = await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79233,
            headSha: fullSha,
            state: 'MERGED',
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
          },
          outcome: 'routed',
          targetSessionId: 'sess_stale_monitor',
          messageKind: 'inform',
          intent: 'github.notification.session_pr',
        },
      ],
    })

    expect(staleRoutedRecord.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      handledCount: 1,
      outcome: 'suppressed',
      requestedOutcome: 'routed',
      targetSessionId: null,
      messageKind: null,
      intent: null,
    })

    const followUpCheck = await tool.execute('call_4', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79233,
            headSha: fullSha,
            state: 'MERGED',
            terminal: 'merged',
            merged: true,
            reviewDecision: 'APPROVED',
          },
        },
      ],
    })

    expect(followUpCheck.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      shouldAct: false,
      lastHandledOutcome: 'suppressed',
      handledCount: 1,
    })
  })

  it('keeps suppressed Paddle PR notification state-object variants handled', async () => {
    const tool = registerTool()
    const eventKey = 'github:thread:79153'
    const fullSha = 'c0e2bbfecd5406472c0be7806b8464be38e7ad04'

    const priorSuppressionRecord = await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey,
          stateDigest: `repo=PaddlePaddle/Paddle;pr=79153;head=${fullSha};merged=true;review=APPROVED`,
          outcome: 'suppressed',
        },
      ],
    })

    expect(priorSuppressionRecord.details.results[0]).toMatchObject({
      stateDigest: `terminal=merged;head=${fullSha};review=approved`,
      handledCount: 1,
      outcome: 'suppressed',
    })

    const repeatCheck = await tool.execute('call_2', {
      action: 'check',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: 79153,
            headSha: fullSha,
            state: 'MERGED',
            reviewDecision: 'APPROVED',
          },
        },
      ],
    })

    expect(repeatCheck.details.results[0]).toMatchObject({
      eventKey,
      stateDigest: `terminal=merged;head=${fullSha};review=approved`,
      handledStatus: 'handled_repeat',
      shouldAct: false,
      lastHandledOutcome: 'suppressed',
      handledCount: 1,
    })

    const duplicateSuppressedRecord = await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          eventKey,
          state: {
            repo: 'PaddlePaddle/Paddle',
            pr: '79153',
            headSha: fullSha,
            terminal: 'merged',
            reviewDecision: 'approved',
          },
          outcome: 'suppressed',
        },
      ],
    })

    expect(duplicateSuppressedRecord.details.results[0]).toMatchObject({
      stateDigest: `terminal=merged;head=${fullSha};review=approved`,
      handledStatus: 'handled_repeat',
      handledCount: 1,
      outcome: 'suppressed',
    })
  })

  it('does not inflate handled count for duplicate records', async () => {
    const tool = registerTool()
    const event = {
      eventKey: 'github:thread:79082',
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
    const abbreviatedRecord = await tool.execute('call_3', {
      action: 'record',
      events: [
        {
          ...event,
          stateDigest: 'head=647a7c539c58;merged=true',
        },
      ],
    })

    expect(firstRecord.details.results[0]).toMatchObject({
      handledCount: 1,
    })
    expect(secondRecord.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      handledCount: 1,
    })
    expect(abbreviatedRecord.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      handledCount: 1,
    })
  })

  it('allows later suppression to replace prior routed handling for the same state', async () => {
    const tool = registerTool()
    const eventKey = 'github:thread:79083'
    const stateDigest = 'head=647a7c539c58a29ff053de3397ddc5c56defd348;merged=true'

    await tool.execute('call_1', {
      action: 'record',
      events: [
        {
          eventKey,
          stateDigest,
          outcome: 'routed',
          targetSessionId: 'sess_monitor_neko_github_watch',
          messageKind: 'inform',
          intent: 'github.notification.session_pr',
        },
      ],
    })

    const suppressionRecord = await tool.execute('call_2', {
      action: 'record',
      events: [
        {
          eventKey,
          stateDigest,
          outcome: 'suppressed',
        },
      ],
    })

    expect(suppressionRecord.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      handledCount: 2,
      outcome: 'suppressed',
      targetSessionId: null,
      messageKind: null,
      intent: null,
    })

    const check = await tool.execute('call_3', {
      action: 'check',
      events: [
        {
          eventKey,
          stateDigest,
        },
      ],
    })

    expect(check.details.results[0]).toMatchObject({
      handledStatus: 'handled_repeat',
      shouldAct: false,
      lastHandledOutcome: 'suppressed',
      handledCount: 2,
    })
  })

  it('rejects Session and repository backcheck keys', async () => {
    const tool = registerTool()

    for (const eventKey of [
      'session-pr:yutto-dev/yutto#776:terminal',
      'github:session-pr:sess_dev_neko_review_yutto_pr_776:yutto-dev/yutto#776',
      'active-pr:yutto-dev/yutto#776:lifecycle',
      'pr-terminal:yutto-dev/yutto#776',
    ]) {
      await expect(
        tool.execute('call_rejected', {
          action: 'check',
          events: [{ eventKey, state: { terminal: 'merged' } }],
        })
      ).rejects.toThrow(
        'synthetic events require the current unread notification key github:thread:<thread_id>'
      )
    }
  })
})

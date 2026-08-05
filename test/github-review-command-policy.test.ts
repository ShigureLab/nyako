import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ')
}

describe('GitHub review command policy', () => {
  it('classifies both refreshed trusted review paths at the Monitor boundary', async () => {
    const [monitor, tools] = await Promise.all([
      read('agents/monitor-neko/AGENTS.md'),
      read('agents/monitor-neko/TOOLS.md'),
    ])
    expect(monitor).toContain('exact `{sourceEvent,classification,currentStatus?}`')
    expect(monitor).toContain('configured trusted actor')
    expect(monitor).toContain('native user-target review-request 确实 target 当前 viewer')
    expect(monitor).toContain('`sourceEvent.body`')
    expect(monitor).toContain('不决定授权')
    expect(monitor).toContain('Monitor 仍不发送')
    expect(tools).toContain('configured trusted actor 的最新 user-target')
    expect(tools).toContain('target 确为当前 viewer')
    expect(tools).toContain('正文明确点名 viewer review')
    expect(tools).toContain('exact `{sourceEvent,classification,currentStatus?}`')
    expect(tools).toContain('必须带 `currentStatus.repo/pr`')
    expect(monitor).toContain('`currentStatus` 必须含 exact `repo`、`pr`')
    expect(monitor).not.toContain('resolve_user_binding')
  })

  it('uses one fixed Hub end-to-end formal review command', async () => {
    const [hub, dev] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])

    expect(hub).toContain('Hub 只负责发送 formal review command')
    expect(hub).toContain('实际审查和 GitHub publication 都由 Dev 在同一 command')
    expect(hub).toContain('Hub 发出 command 后只等待最终 review URL/id')
    expect(hub).toContain('`github.review.publish`')
    expect(hub).toContain('exact `{repo,pr}`')
    expect(hub).toContain('只有这个 fixed Hub sender 的 request 是 formal review command')
    expect(hub).toContain('命中任一路径后直接发送上述 command')
    expect(hub).toContain('两条来源路径择一成立')
    expect(dev).toContain('intent')
    expect(dev).toContain('`github.review.publish`')
    expect(dev).toContain('exact payload `{repo,pr}`')
    expect(dev).toContain('这是唯一 end-to-end formal review command')
    expect(dev).toContain('直接向 Hub 返回最终 review URL/id')
  })

  it('keeps direct-user review possible with Hub as the single binding owner', async () => {
    const [nyako, hub] = await Promise.all([
      read('agents/nyako/AGENTS.md'),
      read('agents/hub-neko/AGENTS.md'),
    ])
    const normalizedHub = normalizeWhitespace(hub)

    expect(nyako).toContain('intent `github.review.publish`')
    expect(nyako).toContain('exact `repo`、`pr`')
    expect(nyako).toContain('不要调用 `resolve_user_binding`')
    expect(hub).toContain('Direct-user 路径')
    expect(hub).toContain('Monitor 路径')
    expect(hub).toContain('owner=nyako 的动态 channel Session')
    expect(normalizedHub).toContain('调用一次 `resolve_user_binding`')
    expect(hub).toContain('明确 positive binding')
    expect(hub).toContain('Hub 不读 GitHub 或提供 SHA')
  })

  it('accepts an explicit trusted GitHub review comment without redundant binding', async () => {
    const [monitor, hub, dev] = await Promise.all([
      read('agents/monitor-neko/AGENTS.md'),
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])

    expect(monitor).toContain('`trusted_human_review_request`')
    expect(monitor).toContain('configured trusted actor')
    expect(monitor).toContain('comment 的 `sourceEvent.body`')
    expect(monitor).toMatch(/Monitor 仍不发送\s+`github\.review\.publish` command/u)
    expect(hub).toContain('完整审查 current head')
    expect(hub).toContain('Hub 信任该固定 sender 的 classification')
    expect(hub).toContain('从 `currentStatus` 取 exact repo/PR')
    expect(hub).toContain('观测 head 不转发也不依赖')
    expect(hub).toContain('不重判 actor、正文或 viewer')
    expect(hub).toContain('不做 cross-platform binding')
    expect(hub).toContain('`github.review.publish`')
    expect(dev).toContain('formal review publication 只接受')
  })

  it('rejects malformed publication commands before any GitHub write', async () => {
    const dev = await read('agents/dev-neko/AGENTS.md')

    expect(dev).toContain('sender 非 `session:hub_neko`')
    expect(dev).toContain('kind 非 `request`')
    expect(dev).toContain('intent 非 `github.review.publish`')
    expect(dev).toContain('缺失 `repo`')
    expect(dev).toContain('或 `pr`')
    expect(dev).toContain('payload 含额外字段')
    expect(dev).toContain('GitHub zero-write')
    expect(dev).toContain('repo/pr 与当前 Session artifacts 不一致')
  })

  it('zero-writes a stale result and re-reviews the new head in the same command', async () => {
    const dev = await read('agents/dev-neko/AGENTS.md')

    expect(dev).toContain('锁定 current head 为 `lockedCommitSha`')
    expect(dev).toContain('完整审查该 commit 的 diff、checks')
    expect(dev).toContain('发布前紧邻再次刷新 current head')
    expect(dev).toContain('丢弃 stale 审查结果并保持 GitHub zero-write')
    expect(dev).toContain('在同一 command 内锁定新 head、从头审查')
    expect(dev).toContain('不结束 obligation')
    expect(dev).toContain('`commit_id=lockedCommitSha`')
  })

  it('deduplicates crash replay and reports only a verified publication', async () => {
    const dev = await read('agents/dev-neko/AGENTS.md')

    expect(dev).toContain('写前先查本 bot 在该 commit 上的 formal review')
    expect(dev).toContain('同任务已写入时复用其 review URL/id')
    expect(dev).toContain('防止 crash replay 重复发布')
    expect(dev).toContain('发布成功且核验实际 review URL/id 后才 reply Hub')
  })

  it('lets Dev verify the exact target without replaying identity policy', async () => {
    const dev = await read('agents/dev-neko/AGENTS.md')

    expect(dev).toContain('当前 Session artifacts、repo、PR')
    expect(dev).toContain('核验实际 review URL/id')
    expect(dev).toMatch(/不重放上游\s+identity\/provenance 策略/u)
    expect(dev).not.toContain('requesterBinding')
  })

  it('enables only task-relevant GitHub skills', async () => {
    const configs = Object.fromEntries(
      await Promise.all(
        [
          'dev-neko',
          'hub-neko',
          'memory-neko',
          'monitor-neko',
          'nyako',
          'plan-neko',
          'research-neko',
        ].map(async (agent) => [agent, await read(`agents/${agent}/agent.toml`)])
      )
    )

    expect(configs['dev-neko']).toContain('"github-conversation"')
    expect(configs['dev-neko']).toContain('"paddlepaddle-contribution-guidelines"')
    expect(configs['monitor-neko']).toContain('enable = ["github-conversation"]')
    expect(configs['research-neko']).toContain('enable = ["github-conversation"]')
    for (const agent of ['hub-neko', 'memory-neko', 'nyako', 'plan-neko']) {
      expect(configs[agent]).toContain('enable = []')
    }

    const all = Object.values(configs).join('\n')
    expect(all).not.toContain('github-contribution-guidelines')
  })
})

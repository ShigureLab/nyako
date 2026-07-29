import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('GitHub review publication policy', () => {
  it('keeps provenance collection factual at the monitor boundary', async () => {
    const monitor = await read('agents/monitor-neko/AGENTS.md')

    expect(monitor).toContain(
      'reviewRequest={eventSource,eventId,actorLogin,requestedReviewerLogin,viewerLogin,requestedAt,verified}'
    )
    expect(monitor).toContain('不决定授权')
    expect(monitor).not.toContain('reviewGrant=')
    expect(monitor).not.toContain('resolve_user_binding')
  })

  it('makes Hub the sole grant signer and keeps the envelope positive', async () => {
    const [hub, dev, monitor, nyako] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
      read('agents/monitor-neko/AGENTS.md'),
      read('agents/nyako/AGENTS.md'),
    ])

    expect(hub).toContain('Hub 是 review publication grant 的唯一签发者')
    expect(hub).toContain('reviewGrant={action:"github.review.publish",repo,pr,basis}')
    expect(hub).toContain('两条来源路径择一成立')
    expect(dev).toContain('Hub 是 review grant 的唯一签发者')
    expect(dev).toContain('`github.review.execute`')
    expect(dev).toContain('reviewGrant={action:"github.review.publish",repo,pr,basis}')
    expect([monitor, nyako].join('\n')).not.toContain('reviewGrant=')

    const combined = [hub, dev, monitor, nyako].join('\n')
    expect(combined).not.toContain('deniedActions')
    expect(combined).not.toContain('scoped_explicit')
    expect(combined).not.toContain('github.review.execute_authorized')
  })

  it('accepts either a bound direct-user request or verified GitHub provenance', async () => {
    const [nyako, hub] = await Promise.all([
      read('agents/nyako/AGENTS.md'),
      read('agents/hub-neko/AGENTS.md'),
    ])

    expect(nyako).toContain('requestedAction="github.review.publish"')
    expect(hub).toContain('Direct-user 路径')
    expect(hub).toContain('Monitor 路径')
    expect(hub).toContain('direct-user 请求不需要补 GitHub provenance')
  })

  it('lets Dev verify the exact target without replaying identity policy', async () => {
    const dev = await read('agents/dev-neko/AGENTS.md')

    expect(dev).toContain('当前 Session artifacts、repo、PR')
    expect(dev).toContain('head')
    expect(dev).toContain('记录 verified outcome')
    expect(dev).toContain('紧邻写入复核 head')
    expect(dev).toContain('不重放上游 identity/provenance 策略')
    expect(dev).not.toContain('requesterBinding')
    expect(dev).not.toContain('reviewRequestProvenance')
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

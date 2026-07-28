import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function readPrompt(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('GitHub follow-up routing policy', () => {
  it('refreshes and preserves the exact source event', async () => {
    const [monitorAgents, monitorTools, hubAgents] = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('agents/monitor-neko/TOOLS.md'),
      readPrompt('agents/hub-neko/AGENTS.md'),
    ])

    expect(monitorAgents).toContain('sourceEvent={type,id,url,actorLogin,body,createdAt}')
    expect(monitorAgents).toContain('发送前最后刷新')
    expect(monitorTools).toContain('紧邻 ledger check / `nnp_send` 再读取一次精确事件')
    expect(hubAgents).toContain('原样保留 `sourceEvent`')
  })

  it('does not let inform messages rewrite session authority', async () => {
    const [monitor, hub, dev] = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('agents/hub-neko/AGENTS.md'),
      readPrompt('agents/dev-neko/AGENTS.md'),
    ])

    for (const prompt of [monitor, hub, dev]) {
      expect(prompt).toMatch(/不(?:能)?授予、撤销或缩小/u)
    }
    expect(hub).toContain('不得生成 `instruction` 字段')
    expect(dev).toContain('范围内的必要修改、commit、push、PR 回复和验证应直接完成')
    expect(dev).toContain('不要把它的只限 review 规则套到普通实现 Session')
  })

  it('keeps ad-hoc instructions out of monitor and hub tool contracts', async () => {
    const prompts = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('agents/monitor-neko/TOOLS.md'),
      readPrompt('agents/hub-neko/AGENTS.md'),
      readPrompt('agents/hub-neko/TOOLS.md'),
    ])
    const combined = prompts.join('\n')

    expect(combined).not.toContain('do not create commits, push')
    expect(combined).not.toContain('Any response must be strictly necessary')
    expect(combined).toContain('payload 不使用 `instruction` 字段')
  })

  it('keeps the routing prompts below the post-cleanup budget', async () => {
    const prompts = await Promise.all(
      [
        'agents/monitor-neko/AGENTS.md',
        'agents/monitor-neko/TOOLS.md',
        'agents/hub-neko/AGENTS.md',
        'agents/hub-neko/TOOLS.md',
        'agents/dev-neko/AGENTS.md',
        'agents/dev-neko/TOOLS.md',
        'agents/nyako/AGENTS.md',
        'agents/nyako/TOOLS.md',
      ].map(readPrompt)
    )

    expect(Buffer.byteLength(prompts.join('\n'))).toBeLessThan(45_000)
  })
})

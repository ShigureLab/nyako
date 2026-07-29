import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('GitHub follow-up routing policy', () => {
  it('refreshes and preserves the exact source event', async () => {
    const [monitorAgents, monitorTools, hub] = await Promise.all([
      read('agents/monitor-neko/AGENTS.md'),
      read('agents/monitor-neko/TOOLS.md'),
      read('agents/hub-neko/AGENTS.md'),
    ])

    expect(monitorAgents).toContain('sourceEvent={type,id,url,actorLogin,body,createdAt}')
    expect(monitorAgents).toContain('发送前最后刷新')
    expect(monitorTools).toContain('再读一次 event 与 current head')
    expect(hub).toContain('follow-up 原样转为 `inform`')
  })

  it('uses the injected Session goal without inventing a scope mutation protocol', async () => {
    const [hub, dev] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])

    for (const prompt of [hub, dev]) {
      expect(prompt).toMatch(/runtime 注入的当前 Session goal/u)
      expect(prompt).toMatch(/`inform` 只增加事实/u)
      expect(prompt).toContain('goal 内的一次性工作项')
      expect(prompt).toContain('不跨消息累计')
      expect(prompt).not.toContain('session.scope.replace')
      expect(prompt).not.toContain('session.stop')
    }
    expect(hub).toContain('新目标创建新业务 Session')
    expect(dev).toContain('新目标使用新 Session')
  })

  it('routes existing-session follow-ups as facts without action hints', async () => {
    const prompts = await Promise.all([
      read('agents/monitor-neko/AGENTS.md'),
      read('agents/monitor-neko/TOOLS.md'),
      read('agents/hub-neko/AGENTS.md'),
      read('agents/hub-neko/TOOLS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])
    const combined = prompts.join('\n')

    expect(combined).toContain(
      '{sourceEvent,classification,currentStatus?,relatedSessionId?,reviewRequest?}'
    )
    expect(combined).not.toContain('suggestedAction')
    expect(combined).not.toContain('deniedActions')
    expect(combined).not.toContain('scoped_explicit')
    expect(combined).not.toContain('Any response must be strictly necessary')
    expect(combined).not.toContain('do not create commits, push')
  })

  it('asks once instead of guessing an ambiguous external write target', async () => {
    const nyako = await read('agents/nyako/AGENTS.md')

    expect(nyako).toContain('只问一次最短澄清')
    expect(nyako).toContain('答案前')
    expect(nyako).toMatch(/不派发、\s*不写入/u)
    expect(nyako).not.toContain('禁止提建议/反问')
  })

  it('keeps prompts small and removes the conflicting generic contribution skill', async () => {
    const groups = await Promise.all(
      ['dev-neko', 'hub-neko', 'monitor-neko', 'nyako'].map(async (agent) => {
        const parts = await Promise.all(
          ['AGENTS.md', 'TOOLS.md', 'SOUL.md'].map((file) => read(`agents/${agent}/${file}`))
        )
        return [agent, parts.join('\n')] as const
      })
    )
    const limits: Record<string, number> = {
      'dev-neko': 3_500,
      'hub-neko': 3_500,
      'monitor-neko': 4_500,
      nyako: 2_800,
    }

    for (const [agent, prompt] of groups) {
      expect(Buffer.byteLength(prompt)).toBeLessThan(limits[agent])
    }
    expect(Buffer.byteLength(groups.map(([, prompt]) => prompt).join('\n'))).toBeLessThan(14_000)
    await expect(
      access(path.join(process.cwd(), 'skills/github-contribution-guidelines/SKILL.md'))
    ).rejects.toThrow()
  })
})

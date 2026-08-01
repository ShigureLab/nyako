import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ')
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
      const normalized = normalizeWhitespace(prompt)
      expect(prompt).toMatch(/runtime 注入的当前 Session goal/u)
      expect(prompt).toMatch(/`inform` 只增加事实/u)
      expect(normalized).toContain('goal 内的一次性工作项')
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
    expect(prompts.join('\n')).toContain(
      '{sourceEvent,classification,currentStatus?,relatedSessionId?}'
    )
  })

  it('inherits an unfinished review and durably defers transient routing failures', async () => {
    const hub = await read('agents/hub-neko/AGENTS.md')
    const normalized = normalizeWhitespace(hub)

    expect(hub).toContain('催办继承同 PR 的未完成 review obligation')
    expect(hub).toContain('绝不创建 reply-only Session')
    expect(hub).toContain('同一 `obligationKey`')
    expect(hub).toContain('`obligationKey="github.review.publish:<repo>#<pr>"`')
    expect(hub).toContain('runtime 保持单一 pending')
    expect(hub).toContain('`nnp_list(status=all)`')
    expect(hub).toContain('不能只看')
    expect(hub).toContain('`session_sleep` 持久重试')
    expect(normalized).toContain('source message/correlation')
    expect(hub).toContain('完整重试参数')
    expect(hub).toContain('普通 assistant 文本和失败说明不算处理完成')
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
      'dev-neko': 3_800,
      'hub-neko': 4_800,
      'monitor-neko': 4_800,
      nyako: 2_800,
    }

    for (const [agent, prompt] of groups) {
      expect(Buffer.byteLength(prompt)).toBeLessThan(limits[agent])
    }
    expect(Buffer.byteLength(groups.map(([, prompt]) => prompt).join('\n'))).toBeLessThan(15_000)
    await expect(
      access(path.join(process.cwd(), 'skills/github-contribution-guidelines/SKILL.md'))
    ).rejects.toThrow()
  })
})

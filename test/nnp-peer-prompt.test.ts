import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const promptPaths = [
  'agents/hub-neko/AGENTS.md',
  'agents/monitor-neko/AGENTS.md',
  'agents/monitor-neko/TOOLS.md',
  'agents/nyako/AGENTS.md',
  'agents/nyako/TOOLS.md',
  'schedules/github-monitor.md',
]

async function readPrompt(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('NNP peer prompt contract', () => {
  test('uses the current NNP tool contract in always-on prompt assets', async () => {
    const prompts = await Promise.all(promptPaths.map(readPrompt))
    const combined = prompts.join('\n')

    expect(combined).not.toContain('session_message_send')
    expect(combined).not.toContain('toSessionId')
    expect(combined).not.toContain('expectsReply=')
  })

  test('teaches the full hub peer address in canonical agent contracts', async () => {
    const [monitorAgents, monitorTools, nyakoAgents] = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('agents/monitor-neko/TOOLS.md'),
      readPrompt('agents/nyako/AGENTS.md'),
    ])
    const monitorPrompt = [monitorAgents, monitorTools].join('\n')

    expect(monitorAgents).toContain('nnp_send(toPeerId="session:hub_neko", kind="inform"')
    expect(monitorTools).toContain('发给 `session:hub_neko` 的 `kind="inform"`')
    expect(monitorPrompt).not.toMatch(/nnp_send\([^)]*kind="request"/u)
    expect(monitorPrompt).not.toContain('eventKey + stateDigest')
    expect(monitorPrompt).toContain('eventKey + canonical actionable state')
    expect(monitorPrompt).toContain('不等待 reply/ack')
    expect(monitorTools).toContain('trusted / ignored actor')
    expect(nyakoAgents).toMatch(/交给\s+`session:hub_neko`/u)
  })

  test('leaves request reply mechanics to the runtime delivery prompt and tool schema', async () => {
    const prompts = await Promise.all([
      readPrompt('agents/dev-neko/AGENTS.md'),
      readPrompt('agents/research-neko/AGENTS.md'),
      readPrompt('agents/plan-neko/AGENTS.md'),
      readPrompt('agents/nyako/AGENTS.md'),
    ])

    const combined = prompts.join('\n')
    expect(combined).not.toContain('replyToMessageId')
    expect(combined).not.toMatch(/普通\s+assistant (?:文本|输出)/u)
  })
})

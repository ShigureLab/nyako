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
    expect(monitorTools).toContain('nnp_send(toPeerId="session:hub_neko", kind="inform"')
    expect(monitorPrompt).not.toMatch(/nnp_send\([^)]*kind="request"/u)
    expect(monitorPrompt).not.toContain('发一次精简 `request`')
    expect(monitorPrompt).not.toMatch(/hub_neko`? 未确认/u)
    expect(monitorPrompt).not.toContain('eventKey + stateDigest')
    expect(monitorPrompt).toContain('eventKey + canonical actionable state')
    expect(monitorPrompt).toContain('不等待 hub reply/ack')
    expect(monitorTools).toContain('[policy].trusted_users')
    expect(nyakoAgents).toContain('nnp_send(toPeerId="session:hub_neko", kind="request"')
  })

  test('keeps upstream NNP delivery rules in the owning agent prompts', async () => {
    const prompts = await Promise.all([
      readPrompt('agents/dev-neko/AGENTS.md'),
      readPrompt('agents/research-neko/AGENTS.md'),
      readPrompt('agents/plan-neko/AGENTS.md'),
      readPrompt('agents/nyako/AGENTS.md'),
    ])

    for (const prompt of prompts) {
      expect(prompt).toContain('nnp_send(kind="reply", replyToMessageId=')
      expect(prompt).toContain('普通 assistant')
    }
  })
})

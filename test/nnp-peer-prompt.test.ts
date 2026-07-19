import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const promptPaths = [
  'agents/hub-neko/AGENTS.md',
  'agents/monitor-neko/AGENTS.md',
  'agents/monitor-neko/TOOLS.md',
  'agents/nyako/AGENTS.md',
  'agents/nyako/TOOLS.md',
  'memory/core.md',
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

  test('teaches the full hub peer address at high-frequency send sites', async () => {
    const [monitorAgents, monitorSchedule, nyakoAgents] = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('schedules/github-monitor.md'),
      readPrompt('agents/nyako/AGENTS.md'),
    ])

    expect(monitorAgents).toContain('nnp_send(toPeerId="session:hub_neko", kind="inform"')
    expect(monitorSchedule).toContain('nnp_send(toPeerId="session:hub_neko", kind="inform"')
    expect(nyakoAgents).toContain('nnp_send(toPeerId="session:hub_neko", kind="request"')
  })
})

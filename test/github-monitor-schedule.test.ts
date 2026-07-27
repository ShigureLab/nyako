import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

function parseSchedule(markdown: string): {
  frontmatter: Record<string, string>
  body: string
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(markdown)
  if (!match) {
    throw new Error('schedule is missing YAML frontmatter')
  }
  const frontmatter = Object.fromEntries(
    match[1]
      .split('\n')
      .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf(':')
        const key = line.slice(0, separator).trim()
        const rawValue = line.slice(separator + 1).trim()
        return [key, rawValue.replace(/^(['"])(.*)\1$/u, '$2')]
      })
  )
  return { frontmatter, body: match[2].trim() }
}

describe('GitHub monitor schedule', () => {
  test('is a compact session.run invocation rather than a policy copy', async () => {
    const markdown = await readFile(
      path.join(process.cwd(), 'schedules', 'github-monitor.md'),
      'utf8'
    )
    const { frontmatter, body } = parseSchedule(markdown)

    expect(frontmatter).toEqual({
      id: 'github-monitor',
      cron: '*/10 * * * *',
      session: 'sess_monitor_neko_github_watch',
      reset: 'true',
      task: 'github.notifications.scan',
    })
    expect(Buffer.byteLength(body)).toBeLessThan(768)
    expect(body).toContain('真实 GitHub unread inbox 扫描')

    for (const outputField of [
      'notifications_fetched',
      'classified',
      'routed',
      'duplicates_suppressed',
      'unmatched',
      'marked_done',
      'duration_ms',
      'review_authorization_candidates',
      'review_authorization_confirmation_required',
      'errors',
    ]) {
      expect(body).toContain(outputField)
    }
    for (const duplicatedPolicyMarker of [
      'github_monitor_ledger',
      'nnp_send(',
      'ReviewRequestedEvent',
      'stateDigest',
      '--auto-collapse-author',
      '## 强制要求',
    ]) {
      expect(body).not.toContain(duplicatedPolicyMarker)
    }
  })

  test('keeps stable behavior in the agent contracts instead of the schedule body', async () => {
    const [agents, tools] = await Promise.all([
      readFile(path.join(process.cwd(), 'agents', 'monitor-neko', 'AGENTS.md'), 'utf8'),
      readFile(path.join(process.cwd(), 'agents', 'monitor-neko', 'TOOLS.md'), 'utf8'),
    ])

    for (const behaviorMarker of [
      '被分配 PR',
      'subscribed',
      'replyToMessageId',
      '纯自动 dependency update',
      '同一 `repo#PR`',
      'non-trusted human comment/mention 只抑制 comment 维度',
    ]) {
      expect(agents).toContain(behaviorMarker)
    }
    for (const toolMarker of [
      '[policy].trusted_users',
      'check-run/status context actor',
      'Issue 必须覆盖 labels 和 assignee',
      'failureFingerprint',
      'check 已自动记录 suppressed',
    ]) {
      expect(tools).toContain(toolMarker)
    }
  })
})

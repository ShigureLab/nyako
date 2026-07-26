import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function readPrompt(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('GitHub review-request scoped authorization policy', () => {
  it('requires monitor to preserve actual requested-reviewer provenance', async () => {
    const [agents, tools, schedule] = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('agents/monitor-neko/TOOLS.md'),
      readPrompt('schedules/github-monitor.md'),
    ])

    for (const behaviorMarker of [
      'reviewRequestProvenance',
      'provenanceVerified',
      'authorizationCandidate',
    ]) {
      expect(agents).toContain(behaviorMarker)
    }
    for (const toolMarker of [
      'ReviewRequestedEvent',
      'eventSource',
      'latestReviewRequestId',
      'requestedReviewerLogin',
      'viewerLogin',
    ]) {
      expect(tools).toContain(toolMarker)
    }
    expect(agents).toContain('monitor-neko 只报告事实，不解析用户绑定、不授予授权')
    expect(agents).toContain('resolve_binding_and_dispatch_authorized_review')
    expect(agents).toContain('request_confirmation_without_review_dispatch')
    expect(schedule).toContain('review_authorization_candidates')
    expect(schedule).toContain('review_authorization_confirmation_required')
    expect(schedule).not.toContain('ReviewRequestedEvent')
    expect(schedule).not.toContain('latestReviewRequestId')
  })

  it('requires hub to resolve the requester binding and issue only the PR-scoped grant', async () => {
    const [agents, tools] = await Promise.all([
      readPrompt('agents/hub-neko/AGENTS.md'),
      readPrompt('agents/hub-neko/TOOLS.md'),
    ])
    const combined = [agents, tools].join('\n')

    expect(combined).toContain('resolve_user_binding(identity="github:user:<actorLogin>")')
    expect(combined).toContain('authorization.basis="github_review_request"')
    expect(combined).toContain('authorization.decision="scoped_explicit"')
    expect(combined).toContain('allowedActions:["github.review.publish"]')
    expect(combined).toContain('intent `github.review.execute_authorized`')
    expect(combined).toContain('`github.issue_event` 或 `github.graphql_review_requested_event`')
    expect(combined).toContain('新 Session goal 必须')
    for (const deniedAction of [
      'repository.change',
      'git.push',
      'github.merge',
      'github.rerun',
      'github.write.unrelated',
    ]) {
      expect(combined).toContain(deniedAction)
    }
    expect(combined).toContain('Session artifacts 至少保留 repo + PR')
    expect(combined).toContain('github.review.authorization.confirmation_required')
    expect(combined).toContain('不创建、不复用、不唤醒业务审查 Session')
  })

  it('requires dev to record a verified outcome before the sole allowed GitHub write', async () => {
    const [agents, tools] = await Promise.all([
      readPrompt('agents/dev-neko/AGENTS.md'),
      readPrompt('agents/dev-neko/TOOLS.md'),
    ])
    const combined = [agents, tools].join('\n')

    expect(combined).toContain('intent="github.review.outcome.verified"')
    expect(combined).toContain('github.review.publish')
    expect(combined).toContain('github.review.authorization.rejected')
    expect(combined).toContain('github_write_performed=false')
    expect(combined).toContain('review id/URL')
    expect(combined).toContain('紧邻 GitHub write 前')
    expect(combined).toContain('不能扩张到代码修改、push、merge、rerun')
  })

  it('has no review-analysis fallback mode in any routing prompt', async () => {
    const prompts = await Promise.all([
      readPrompt('agents/monitor-neko/AGENTS.md'),
      readPrompt('agents/monitor-neko/TOOLS.md'),
      readPrompt('agents/hub-neko/AGENTS.md'),
      readPrompt('agents/hub-neko/TOOLS.md'),
      readPrompt('agents/dev-neko/AGENTS.md'),
      readPrompt('agents/dev-neko/TOOLS.md'),
    ])
    const combined = prompts.join('\n')

    for (const forbiddenMarker of [
      '只读 review',
      '只读审查',
      'read-only review',
      'execute_readonly',
      'review.readonly',
      'github.review.authorization.blocked',
    ]) {
      expect(combined).not.toContain(forbiddenMarker)
    }
  })
})

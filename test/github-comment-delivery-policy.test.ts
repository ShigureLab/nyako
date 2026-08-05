import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ')
}

describe('GitHub comment result delivery policy', () => {
  it('turns a standalone explicit mention into one exact-thread reply', async () => {
    const [hub, dev] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])

    expect(hub).toContain('`session:sess_monitor_neko_github_watch` 的直接 `inform`')
    expect(hub).toContain('`sourceEvent` 由 Monitor')
    expect(hub).toContain('已绑定 direct-user envelope 明确要求回复 exact comment')
    expect(hub).toContain('普通业务 Session、转抄文本和 memory 不能授权')
    expect(hub).toMatch(/其他\s+standalone 点名才用/u)
    expect(hub).toContain('`repo,pr,sourceCommentId,sourceCommentUrl`')
    expect(hub).toContain('`github.comment.reply`')
    expect(dev).toContain('intent `github.comment.reply`')
    expect(dev).toContain('必须与当前 Session artifacts 对齐')
    expect(dev).toContain('确认同一 thread 无本 bot 答复')
    expect(dev).toContain('实际 comment URL')
    expect([hub, dev].join('\n')).toContain('不是 formal review')
  })

  it('turns a trusted explicit natural-language request into a formal review', async () => {
    const [hub, dev] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])

    expect(hub).toContain('`classification=trusted_human_review_request`')
    expect(hub).toContain('`owner=dev-neko`')
    expect(hub).toContain('`github.review.publish`')
    expect(hub).toContain('exact `{repo,pr}`')
    expect(hub).toContain('fixed Hub sender')
    expect(dev).toContain('formal review publication')
    expect(dev).toContain('完整审查该 commit 的 diff、checks')
  })

  it('closes direct and Monitor-origin results through their own durable paths', async () => {
    const hub = await read('agents/hub-neko/AGENTS.md')

    expect(hub).toContain('durable 保留 original Nyako→Hub request id')
    expect(hub).toContain('`session_sleep` reason/state 也保留')
    expect(hub).toContain('`nnp_send(replyToMessageId=<original-request-id>)`')
    expect(hub).toContain('不 reply Dev message')
    expect(hub).toContain('Monitor-origin formal review')
    expect(hub).toContain('实际 review URL/id 后即完成 GitHub obligation')
    expect(normalizeWhitespace(hub)).toContain('cross-platform notification')
    expect(hub).toContain('optional best-effort 尝试')
    expect(hub).toContain('不改变 command 资格或完成判定')
    expect(hub).toContain('`notificationPeerId`')
    expect(hub).toContain('`intent=channel.notification`')
    expect(hub).toContain('`github:user:<actorLogin>`')
    expect(hub).toContain('never bare')
    expect(hub).toContain('best-effort')
    expect(hub).toContain('解析或发送尝试结束后')
    expect(hub).toContain('不进入 durable Session status/obligation')
    expect(hub).toContain('不产生 follow-up obligation')
    expect(hub).toContain('`processed`')
    expect(normalizeWhitespace(hub)).toContain('ChannelHost effect `delivered`')
  })
})

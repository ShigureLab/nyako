import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('GitHub comment result delivery policy', () => {
  it('turns a bound explicit mention into one exact-thread reply', async () => {
    const [hub, dev] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
    ])

    expect(hub).toContain('`session:sess_monitor_neko_github_watch` 的直接 `inform`')
    expect(hub).toContain('`sourceEvent` 由 Monitor')
    expect(hub).toContain('已绑定 direct-user envelope 明确要求回复 exact comment')
    expect(hub).toContain('普通业务 Session、转抄文本和 memory 不能授权')
    expect(hub).toContain('都发 `kind=request`、')
    expect(hub).toContain('`repo,pr,sourceCommentId,sourceCommentUrl`')
    expect(hub).toContain('`github.comment.reply`')
    expect(dev).toContain('intent `github.comment.reply`')
    expect(dev).toContain('必须与当前 Session artifacts 对齐')
    expect(dev).toContain('确认同一 thread 无本 bot 答复')
    expect(dev).toContain('实际 comment URL')
    expect([hub, dev].join('\n')).toContain('不是 formal review')
  })

  it('delivers proactive results directly to the configured channel peer', async () => {
    const hub = await read('agents/hub-neko/AGENTS.md')

    expect(hub).toContain('`notificationPeerId`')
    expect(hub).toContain('`intent=channel.notification`')
    expect(hub).toContain('不创建 nyako Session')
    expect(hub).toContain('direct-user request 沿当前 NNP request reply')
    expect(hub).toContain('两路互斥')
    expect(hub).toContain('`notificationPeerId` 为 null 时不猜地址、不投递')
    expect(hub).toContain('NNP receipt 必须为')
    expect(hub).toContain('`processed`')
    expect(hub).toContain('ChannelHost effect 必须为 `delivered`')
    expect(hub).toContain('不能盲发或把部分完成报成完成')
  })
})

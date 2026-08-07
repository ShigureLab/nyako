import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('GitHub review Session lifecycle policy', () => {
  it('reuses one canonical Session across every review cycle', async () => {
    const [hub, dev, readme] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
      read('README.md'),
    ])

    expect(hub).toContain('生命周期键固定为 canonical `<repo>#<pr>`')
    expect(hub).toContain('新 head、re-review、催办和再次')
    expect(hub).toContain('都复用同一个 active `owner=dev-neko` Session')
    expect(hub).toContain('`current_head`、`latest_head`、`revised_head` 等变体 Session')
    expect(dev).toContain('从首次 review 到 merge 的完整生命周期')
    expect(readme).toContain('同一 `<repo>#<pr>` 只使用一个持续复用的 PR review Session')
  })

  it('keeps the Session after publication and archives only after merge', async () => {
    const [hub, dev, monitor, cleanup] = await Promise.all([
      read('agents/hub-neko/AGENTS.md'),
      read('agents/dev-neko/AGENTS.md'),
      read('agents/monitor-neko/AGENTS.md'),
      read('schedules/session-cleanup.md'),
    ])

    expect(hub).toContain('`github.review.published` reply')
    expect(hub).toContain('都不是归档条件')
    expect(hub).toContain('`merged=true` 或 lifecycle state 为 `MERGED`')
    expect(hub).toContain('closed-unmerged 也不归档')
    expect(dev).toContain('reply 后保持 Session active')
    expect(dev).toContain('`github.review.skipped_merged` reply Hub')
    expect(dev).toContain('保持 GitHub zero-write')
    expect(monitor).toContain('只有 `merged=true` 或 state=`MERGED`')
    expect(cleanup).toContain('closed-unmerged 不满足')
    expect(cleanup).toContain('只归档 live 核实已 merged')
  })

  it('deduplicates merge archive retries by PR lifecycle key', async () => {
    const hub = await read('agents/hub-neko/AGENTS.md')

    expect(hub).toContain('`obligationKey="github.review.archive:<repo>#<pr>"`')
    expect(hub).toContain('最多保留一个')
    expect(hub).toContain('成功后不再保留或创建归档 wake')
  })
})

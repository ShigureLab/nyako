import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'

test('dev-neko keeps the lgtmeow recipe out of GitHub review bodies', async () => {
  const prompt = await readFile(path.join(process.cwd(), 'agents', 'dev-neko', 'TOOLS.md'), 'utf8')

  expect(prompt).toContain("lgtmeow -r 2>&1 | awk '/<img / { print; exit }'")
  expect(prompt).toContain('LGTMeow <来源 emoji>+🐾')
  expect(prompt).toContain('禁止')
  expect(prompt).toContain('最终 review body 都必须只保留唯一一行包含 `<img ...>`')
})

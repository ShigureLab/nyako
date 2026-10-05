import { describe, expect, it, vi, afterEach } from 'vite-plus/test'
import { fetch, Response } from 'undici'
import { assertPublicAddress, fetchWebText, publicUrl } from '../tools/web/http.ts'
import { createWebTools, extractPage, parseSearchResults } from '../tools/web/index.ts'

vi.mock('undici', async (original) => ({
  ...(await original<typeof import('undici')>()),
  fetch: vi.fn(),
}))

afterEach(() => vi.mocked(fetch).mockReset())

const context = { abortSignal: new AbortController().signal } as never
const feed = `<rss><channel><item><title>官方 &amp; 文档</title><link>https://example.com/?a=1&amp;b=2</link><description><![CDATA[说明 & 示例]]></description></item><item><title>Second</title><link>https://example.org/</link><description>Other result</description></item></channel></rss>`

describe('web sources', () => {
  it('decodes search titles and source URLs, bounds results, and rejects non-feeds', () => {
    expect(parseSearchResults(feed, 1)).toEqual([
      {
        title: '官方 & 文档',
        url: 'https://example.com/?a=1&b=2',
        snippet: '说明 & 示例',
      },
    ])
    expect(parseSearchResults('<rss><channel/></rss>', 5)).toEqual([])
    expect(() => parseSearchResults('<html>Challenge required</html>', 5)).toThrow('RSS')
  })

  it('extracts readable paragraphs without scripts or navigation', () => {
    const paragraph =
      'This article explains an important public fact with enough detail to be useful. '.repeat(12)
    const page = extractPage(
      `<html><head><title>Official report</title><meta property="article:published_time" content="2026-10-05"/></head><body><nav>Account settings</nav><article><h1>Official report</h1><p>${paragraph}</p><p>Final conclusion.</p></article><script>secretScript()</script></body></html>`,
      'https://example.com/report'
    )
    expect(page.title).toBe('Official report')
    expect(page.publishedTime).toBe('2026-10-05')
    expect(page.text).toContain(paragraph.trim())
    expect(page.text).toMatch(/useful\.\n+Final conclusion\./)
    expect(page.text).not.toMatch(/secretScript|Account settings/)
  })

  it('passes encoded search terms and cancellation through the registered tool', async () => {
    const read = vi.fn<typeof fetchWebText>().mockResolvedValue({
      url: 'https://www.bing.com/search',
      contentType: 'text/xml',
      text: feed,
    })
    const [search] = createWebTools(read)
    const result = await search.execute(
      { query: ' 最新 Node.js & release ', maxResults: 1 },
      undefined as never,
      context
    )
    const requested = new URL(read.mock.calls[0]![0]!)
    expect(requested.searchParams.get('q')).toBe('最新 Node.js & release')
    expect(read.mock.calls[0]![1]).toBe((context as { abortSignal: AbortSignal }).abortSignal)
    expect(result.details).toMatchObject({ results: parseSearchResults(feed, 1) })
    await expect(search.execute({ query: '  ' }, undefined as never, context)).rejects.toThrow(
      'non-empty'
    )
  })

  it('preserves code identifiers and indentation from interactive documentation', () => {
    const page = extractPage(
      `<html><body><article><p>${'This documentation explains a public API. '.repeat(30)}</p><pre><code>const <button>x</button> = 1;\n  console.log(x);\n</code></pre></article></body></html>`,
      'https://example.com/docs'
    )
    expect(page.text).toContain('const x = 1;\n  console.log(x);')
  })

  it('returns final source URLs and continuation slices without losing content', async () => {
    const text = 'abcdef'.repeat(300)
    const [, tool] = createWebTools(async () => ({
      url: 'https://example.com/final',
      contentType: 'text/plain',
      text,
    }))
    const first = await tool.execute(
      { url: 'https://example.com/start', maxChars: 500 },
      undefined as never,
      context
    )
    const second = await tool.execute(
      { url: 'https://example.com/start', offset: 500, maxChars: 2000 },
      undefined as never,
      context
    )
    expect(first.details).toMatchObject({
      url: 'https://example.com/final',
      nextOffset: 500,
      totalChars: 1800,
    })
    const firstPage = first.details as { text: string }
    const secondPage = second.details as { text: string }
    expect(firstPage.text + secondPage.text).toBe(text)
    expect(second.details).toMatchObject({ nextOffset: null })
  })
})

describe('public web HTTP boundary', () => {
  it('rejects local/private targets, credential URLs and non-HTTP protocols', () => {
    for (const url of [
      'file:///etc/passwd',
      'https://user:pass@example.com',
      'http://127.1',
      'http://10.0.0.1',
      'http://169.254.169.254',
      'http://[::1]',
      'http://[::ffff:127.0.0.1]',
      'http://[fd00::1]',
    ]) {
      expect(() => publicUrl(url)).toThrow()
    }
    for (const address of ['192.168.1.1', '172.16.0.1', '100.64.0.1', 'fe80::1'])
      expect(() => assertPublicAddress(address)).toThrow()
    expect(publicUrl('https://example.com/page#section').href).toBe('https://example.com/page')
    expect(() => assertPublicAddress('8.8.8.8')).not.toThrow()
    expect(() => assertPublicAddress('2606:4700:4700::1111')).not.toThrow()
  })

  it('follows relative redirects and checks their destinations before requesting', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final' } }))
      .mockResolvedValueOnce(
        new Response('Final page', { headers: { 'content-type': 'text/plain' } })
      )
    expect(await fetchWebText('https://example.com/start')).toMatchObject({
      url: 'https://example.com/final',
      text: 'Final page',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
      )
    await expect(fetchWebText('https://example.com/start')).rejects.toThrow('public internet')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects error, binary and oversized responses', async () => {
    for (const response of [
      new Response('Denied', { status: 403 }),
      new Response('PDF', { headers: { 'content-type': 'application/pdf' } }),
      new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/plain' } }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(response)
      await expect(fetchWebText('https://example.com/')).rejects.toThrow()
    }
  })
})

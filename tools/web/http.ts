import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent, fetch } from 'undici'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(address, prefix)
}
blocked.addAddress('::', 'ipv6')
blocked.addAddress('::1', 'ipv6')
blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')
blocked.addSubnet('ff00::', 8, 'ipv6')

export function assertPublicAddress(address: string): void {
  const family = isIP(address)
  if (!family || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')) {
    throw new Error('Web tools require a public internet address')
  }
}

export function publicUrl(input: string): URL {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Web tools require an HTTP(S) URL without embedded credentials')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) assertPublicAddress(hostname)
  url.hash = ''
  return url
}

// Validate the actual socket address during resolution, rather than checking DNS and resolving again.
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, [], 0)
        try {
          for (const { address } of addresses) assertPublicAddress(address)
          if (options.all) callback(null, addresses)
          else callback(null, addresses[0]!.address, addresses[0]!.family)
        } catch (cause) {
          callback(cause as Error, [], 0)
        }
      })
    },
  },
})

const maxBytes = 2 * 1024 * 1024

export async function fetchWebText(input: string, abortSignal?: AbortSignal) {
  let url = publicUrl(input)
  const timeout = AbortSignal.timeout(20_000)
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, {
      dispatcher,
      redirect: 'manual',
      signal,
      headers: {
        'user-agent': 'Nyako/0.1 (public web reader)',
        accept: 'text/*, application/json, application/xml, application/xhtml+xml',
      },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) throw new Error('Web redirect has no Location header')
      url = publicUrl(new URL(location, url).href)
      continue
    }
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!response.ok || !/^(text\/|application\/(json|xml|xhtml\+xml)$)/.test(contentType)) {
      await response.body?.cancel()
      throw new Error(
        `Web request returned HTTP ${response.status} (${contentType || 'unknown content type'})`
      )
    }
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) throw new Error('Web response exceeds the 2 MiB limit')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(
      response.headers.get('content-type') ?? ''
    )?.[1]
    return {
      url: url.href,
      contentType,
      text: new TextDecoder(charset ?? 'utf-8').decode(Buffer.concat(chunks)),
    }
  }
  throw new Error('Web request exceeded the redirect limit')
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import registerUserBindingTool, { UserBindingConfig } from '../tools/users/index.ts'
import registerSearchUserBindingsTool, { type searchUserBindings } from '../tools/users/search.ts'
import registerHubUserTools from '../agents/hub-neko/extensions/user-bindings.ts'
import registerNyakoUserSearch from '../agents/nyako/extensions/user-search.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

type BindingInput = {
  id: string
  identities: string[]
  notificationPeerId?: string
}

async function writeBindings(bindings: BindingInput[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nyako-user-bindings-'))
  tempDirs.push(root)
  const configPath = path.join(root, 'config.toml')
  const lines = ['[tool.user-binding]', '']
  for (const binding of bindings) {
    lines.push(
      '[[tool.user-binding.bindings]]',
      `id = ${JSON.stringify(binding.id)}`,
      ...(binding.notificationPeerId
        ? [`notificationPeerId = ${JSON.stringify(binding.notificationPeerId)}`]
        : []),
      `identities = ${JSON.stringify(binding.identities)}`,
      ''
    )
  }
  await writeFile(configPath, lines.join('\n'))
  return configPath
}

describe('user binding tool', () => {
  it('resolves explicit and canonical identities from machine-local config', async () => {
    const configPath = await writeBindings([
      { id: 'shigure', identities: ['telegram:42', 'github:user:Shigure'] },
    ])
    const users = new UserBindingConfig(configPath)

    await expect(users.resolve('telegram:42')).resolves.toEqual({
      id: 'shigure',
      canonicalIdentity: 'user:shigure',
      identities: ['telegram:42', 'github:user:Shigure'],
      notificationPeerId: null,
    })
    await expect(users.resolve('user:shigure')).resolves.toMatchObject({ id: 'shigure' })
    await expect(users.resolve('telegram:unknown')).resolves.toBeNull()
  })

  it('returns an explicit notification peer and rejects invalid destinations', async () => {
    const validPath = await writeBindings([
      {
        id: 'shigure',
        identities: ['telegram:user:42', 'github:user:Shigure'],
        notificationPeerId: 'endpoint:telegram:telegram:user:42',
      },
    ])
    await expect(new UserBindingConfig(validPath).resolve('github:user:Shigure')).resolves.toEqual({
      id: 'shigure',
      canonicalIdentity: 'user:shigure',
      identities: ['telegram:user:42', 'github:user:Shigure'],
      notificationPeerId: 'endpoint:telegram:telegram:user:42',
    })

    const invalidPath = await writeBindings([
      {
        id: 'invalid',
        identities: ['telegram:user:invalid'],
        notificationPeerId: 'endpoint:telegram:telegram:user:someone-else',
      },
    ])
    await expect(new UserBindingConfig(invalidPath).list()).rejects.toThrow(
      'notificationPeerId driver must match an explicitly bound identity'
    )
  })

  it('rejects duplicate identity ownership', async () => {
    const configPath = await writeBindings([
      { id: 'first', identities: ['telegram:42'] },
      { id: 'second', identities: ['telegram:42'] },
    ])
    await expect(new UserBindingConfig(configPath).list()).rejects.toThrow(
      'is bound to both "first" and "second"'
    )
  })

  it('returns no bindings when the local config is absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nyako-missing-config-'))
    tempDirs.push(root)
    await expect(new UserBindingConfig(path.join(root, 'config.toml')).list()).resolves.toEqual([])
  })

  it('registers resolve_user_binding as a native Pi extension tool', async () => {
    const configPath = await writeBindings([
      { id: 'owner', identities: ['github:user:ExampleOwner'] },
    ])
    let tool:
      | {
          description?: string
          name: string
          execute(toolCallId: string, input: { identity: string }): Promise<any>
        }
      | undefined
    registerUserBindingTool(
      {
        registerTool(candidate) {
          tool = candidate
        },
      } as ExtensionAPI,
      new UserBindingConfig(configPath)
    )

    expect(tool?.name).toBe('resolve_user_binding')
    expect(tool?.description).toContain('github:user:<login>')
    expect(tool?.description).toContain('bare logins never match')
    expect(await tool?.execute('call_1', { identity: 'telegram:unknown' })).toMatchObject({
      details: { found: false, identity: 'telegram:unknown' },
    })
    expect(await tool?.execute('call_2', { identity: 'github:user:ExampleOwner' })).toMatchObject({
      details: {
        found: true,
        id: 'owner',
        notificationPeerId: null,
      },
    })
    for (const identity of ['ExampleOwner', 'github:user:exampleowner', 'github:user:Example']) {
      expect(await tool?.execute('exact-only', { identity })).toMatchObject({
        details: { found: false },
      })
    }
  })

  it('exposes search to Nyako and Hub, with exact resolution only on Hub', () => {
    const hubTools: string[] = []
    const nyakoTools: string[] = []
    registerHubUserTools({ registerTool: (tool) => hubTools.push(tool.name) })
    registerNyakoUserSearch({ registerTool: (tool) => nyakoTools.push(tool.name) })
    expect(hubTools).toEqual(['resolve_user_binding', 'search_user_bindings'])
    expect(nyakoTools).toEqual(['search_user_bindings'])
  })
})

async function searchTool(bindings: BindingInput[]) {
  const configPath = await writeBindings(bindings)
  let tool: Parameters<ExtensionAPI['registerTool']>[0]
  registerSearchUserBindingsTool(
    {
      registerTool(candidate) {
        tool = candidate
      },
    },
    new UserBindingConfig(configPath)
  )
  return async (query: string, scope?: string) => {
    const result = await tool.execute('search', {
      query,
      ...(scope === undefined ? {} : { scope }),
    })
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.details)
    return result.details as ReturnType<typeof searchUserBindings>
  }
}

describe('user binding name search', () => {
  it('resolves a nickname to scoped names and accounts without a notification destination', async () => {
    const search = await searchTool([
      {
        id: 'example',
        notificationPeerId: 'endpoint:telegram:telegram:user:42',
        identities: [
          'nickname:小栗子',
          'nickname:栗栗',
          'realname:示例甲',
          'hi:contact:example@example.com',
          'github:user:ExampleLogin',
          'telegram:user:42',
          'telegram:chat:42',
        ],
      },
    ])
    const result = await search(' 小栗子 ')
    expect(result).toMatchObject({ query: '小栗子', ambiguous: false, warnings: [] })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      id: 'example',
      canonicalIdentity: 'user:example',
      matches: [
        {
          identity: 'nickname:小栗子',
          scope: 'nickname',
          kind: null,
          value: '小栗子',
          matchType: 'exact',
        },
      ],
      identities: [
        { scope: 'nickname', kind: null, value: '小栗子' },
        { scope: 'nickname', kind: null, value: '栗栗' },
        { scope: 'realname', kind: null, value: '示例甲' },
        { scope: 'hi', kind: 'contact', value: 'example@example.com' },
        { scope: 'github', kind: 'user', value: 'ExampleLogin' },
        { scope: 'telegram', kind: 'user', value: '42' },
        { scope: 'telegram', kind: 'chat', value: '42' },
      ],
    })
    expect(result.candidates[0]).not.toHaveProperty('notificationPeerId')
  })

  it('groups matches by person, ranks exact before folded and partial matches, and warns about ambiguity', async () => {
    const search = await searchTool([
      { id: 'partial', identities: ['nickname:Alexandra'] },
      { id: 'folded', identities: ['github:user:alex'] },
      { id: 'exact', identities: ['nickname:Alex', 'realname:Alex', 'github:user:AlexDev'] },
    ])
    const result = await search('Alex')
    expect(result.ambiguous).toBe(true)
    expect(result.warnings).toHaveLength(2)
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'exact',
      'folded',
      'partial',
    ])
    expect(result.candidates.map((candidate) => candidate.matches[0]!.matchType)).toEqual([
      'exact',
      'case_insensitive',
      'substring',
    ])
    expect(result.candidates[0]!.matches.map((match) => match.scope)).toEqual([
      'nickname',
      'realname',
      'github',
    ])
  })

  it('restricts the searched scope while still returning linked identities in other scopes', async () => {
    const search = await searchTool([
      { id: 'name', identities: ['nickname:Alex', 'github:user:SomeoneElse'] },
      { id: 'account', identities: ['nickname:LittleA', 'github:user:Alex'] },
    ])
    const result = await search('Alex', 'github')
    expect(result).toMatchObject({ scope: 'github', ambiguous: false, warnings: [] })
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['account'])
    expect(result.candidates[0]!.identities).toContainEqual({
      identity: 'nickname:LittleA',
      scope: 'nickname',
      kind: null,
      value: 'LittleA',
    })
  })

  it('warns for one partial candidate and for multiple exact name candidates', async () => {
    const search = await searchTool([
      { id: 'first', identities: ['nickname:小栗子', 'realname:共享名字'] },
      { id: 'second', identities: ['nickname:共享名字'] },
    ])
    const partial = await search('栗子')
    expect(partial).toMatchObject({ ambiguous: false })
    expect(partial.candidates).toHaveLength(1)
    expect(partial.warnings).toHaveLength(1)
    const shared = await search('共享名字')
    expect(shared).toMatchObject({ ambiguous: true })
    expect(shared.candidates).toHaveLength(2)
    expect(shared.warnings).toHaveLength(1)
  })

  it('matches values rather than scope prefixes, and preserves colon-containing aliases', async () => {
    const search = await searchTool([
      {
        id: 'example',
        identities: ['nickname:Team:Alice', 'telegram:42', 'custom:Alice', 'Unscoped'],
      },
    ])
    expect((await search('Team:Alice')).candidates[0]!.matches).toEqual([
      {
        identity: 'nickname:Team:Alice',
        scope: 'nickname',
        kind: null,
        value: 'Team:Alice',
        matchType: 'exact',
      },
    ])
    expect((await search('42')).candidates[0]!.matches[0]).toMatchObject({
      scope: 'telegram',
      kind: null,
      value: '42',
    })
    expect((await search('Unscoped')).candidates[0]!.matches[0]).toMatchObject({
      scope: null,
      kind: null,
      value: 'Unscoped',
    })
    expect((await search('example', 'user')).candidates[0]!.canonicalIdentity).toBe('user:example')
    for (const query of ['missing', 'nickname', 'telegram', '小栗子在干啥']) {
      expect(await search(query)).toMatchObject({ ambiguous: false, warnings: [], candidates: [] })
    }
    await expect(search('   ')).rejects.toThrow('query must be a non-empty string')
    await expect(search('Alice', '   ')).rejects.toThrow('scope must be a non-empty string')
  })
})

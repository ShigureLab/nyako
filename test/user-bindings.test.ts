import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import registerUserBindingTool, { UserBindingConfig } from '../tools/users/index.ts'

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
  })

  it('exposes the binding extension only to Hub', async () => {
    await expect(
      access(path.join(process.cwd(), 'agents', 'nyako', 'extensions', 'user-bindings.ts'))
    ).rejects.toThrow()
    await expect(
      readFile(
        path.join(process.cwd(), 'agents', 'hub-neko', 'extensions', 'user-bindings.ts'),
        'utf8'
      )
    ).resolves.toContain('../../../tools/users/index.ts')
  })
})

import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import registerUserBindingTool, { UserBindingDirectory } from '../tools/users/index.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function bindingsDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nyako-user-bindings-'))
  tempDirs.push(root)
  const directory = path.join(root, 'users')
  await mkdir(directory)
  return directory
}

async function writeBinding(
  directory: string,
  name: string,
  id: string,
  identities: string[],
  notificationPeerId?: string
) {
  await writeFile(
    path.join(directory, name),
    [
      `id = ${JSON.stringify(id)}`,
      ...(notificationPeerId ? [`notificationPeerId = ${JSON.stringify(notificationPeerId)}`] : []),
      `identities = ${JSON.stringify(identities)}`,
      '',
    ].join('\n')
  )
}

describe('user binding tool', () => {
  it('resolves explicit and canonical identities', async () => {
    const directory = await bindingsDirectory()
    await writeBinding(directory, 'shigure.toml', 'shigure', ['telegram:42', 'github:user:Shigure'])
    const users = new UserBindingDirectory(directory)

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
    const directory = await bindingsDirectory()
    await writeBinding(
      directory,
      'shigure.toml',
      'shigure',
      ['telegram:user:42', 'github:user:Shigure'],
      'endpoint:telegram:telegram:user:42'
    )

    await expect(
      new UserBindingDirectory(directory).resolve('github:user:Shigure')
    ).resolves.toEqual({
      id: 'shigure',
      canonicalIdentity: 'user:shigure',
      identities: ['telegram:user:42', 'github:user:Shigure'],
      notificationPeerId: 'endpoint:telegram:telegram:user:42',
    })

    await writeBinding(
      directory,
      'invalid.toml',
      'invalid',
      ['telegram:user:invalid'],
      'endpoint:telegram:telegram:user:someone-else'
    )
    await expect(new UserBindingDirectory(directory).list()).rejects.toThrow(
      'notificationPeerId driver must match an explicitly bound identity'
    )

    await rm(path.join(directory, 'invalid.toml'))
    await writeBinding(
      directory,
      'wrong-driver.toml',
      'wrong-driver',
      ['github:user:wrong-driver'],
      'endpoint:telegram:github:user:wrong-driver'
    )
    await expect(new UserBindingDirectory(directory).list()).rejects.toThrow(
      'notificationPeerId driver must match an explicitly bound identity'
    )
  })

  it('rejects duplicate ownership and ignores symlinked records', async () => {
    const directory = await bindingsDirectory()
    await writeBinding(directory, 'first.toml', 'first', ['telegram:42'])
    await writeBinding(directory, 'second.toml', 'second', ['telegram:42'])
    await expect(new UserBindingDirectory(directory).list()).rejects.toThrow(
      'is bound to both "first" and "second"'
    )

    await rm(path.join(directory, 'second.toml'))
    const outside = path.join(path.dirname(directory), 'outside.toml')
    await writeBinding(path.dirname(outside), path.basename(outside), 'outside', ['telegram:99'])
    await symlink(outside, path.join(directory, 'linked.toml'))
    await expect(new UserBindingDirectory(directory).list()).resolves.toHaveLength(1)
  })

  it('registers resolve_user_binding as a native Pi extension tool', async () => {
    let tool:
      | {
          description: string
          name: string
          execute(toolCallId: string, input: { identity: string }): Promise<any>
        }
      | undefined
    registerUserBindingTool({
      registerTool(candidate) {
        tool = candidate
      },
    } as ExtensionAPI)

    expect(tool?.name).toBe('resolve_user_binding')
    expect(tool?.description).toContain('github:user:<login>')
    expect(tool?.description).toContain('bare logins never match')
    expect(await tool?.execute('call_1', { identity: 'telegram:unknown' })).toMatchObject({
      details: { found: false, identity: 'telegram:unknown' },
    })
    expect(await tool?.execute('call_2', { identity: 'github:user:SigureMo' })).toMatchObject({
      details: {
        found: true,
        id: 'xuxiaojian',
        notificationPeerId: null,
      },
    })
  })

  it('loads the definition-owned binding records by default', async () => {
    await expect(new UserBindingDirectory().resolve('github:user:SigureMo')).resolves.toMatchObject(
      {
        id: 'xuxiaojian',
        canonicalIdentity: 'user:xuxiaojian',
        notificationPeerId: null,
      }
    )
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

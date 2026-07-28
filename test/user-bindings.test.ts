import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import registerUserBindingTool, { UserBindingDirectory } from '../tools/user-bindings.ts'

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

async function writeBinding(directory: string, name: string, id: string, identities: string[]) {
  await writeFile(
    path.join(directory, name),
    [`id = ${JSON.stringify(id)}`, `identities = ${JSON.stringify(identities)}`, ''].join('\n')
  )
}

describe('user binding tool', () => {
  it('resolves explicit and canonical identities', async () => {
    const directory = await bindingsDirectory()
    await writeBinding(directory, 'shigure.toml', 'shigure', ['telegram:42', 'infoflow:abc'])
    const users = new UserBindingDirectory(directory)

    await expect(users.resolve('telegram:42')).resolves.toEqual({
      id: 'shigure',
      canonicalIdentity: 'user:shigure',
      identities: ['telegram:42', 'infoflow:abc'],
    })
    await expect(users.resolve('user:shigure')).resolves.toMatchObject({ id: 'shigure' })
    await expect(users.resolve('telegram:unknown')).resolves.toBeNull()
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
    expect(await tool?.execute('call_1', { identity: 'telegram:unknown' })).toMatchObject({
      details: { found: false, identity: 'telegram:unknown' },
    })
  })
})

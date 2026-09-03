import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import registerGithubPolicyTool, { GithubAdapterPolicy } from '../tools/github/index.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function writeConfig(source: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nyako-github-policy-'))
  tempDirs.push(root)
  const configPath = path.join(root, 'config.toml')
  await writeFile(configPath, source)
  return configPath
}

describe('GitHub adapter policy tool', () => {
  it('checks exact trusted logins from machine-local config', async () => {
    const configPath = await writeConfig(
      ['[adapter.github]', 'trusted_users = ["octocat", "ExactCase"]', ''].join('\n')
    )
    const policy = new GithubAdapterPolicy(configPath)

    await expect(policy.isTrusted('octocat')).resolves.toBe(true)
    await expect(policy.isTrusted('exactcase')).resolves.toBe(false)
    await expect(policy.isTrusted('stranger')).resolves.toBe(false)
  })

  it('rejects malformed or ambiguous policy', async () => {
    const duplicatePath = await writeConfig(
      ['[adapter.github]', 'trusted_users = ["octocat", "octocat"]', ''].join('\n')
    )
    await expect(new GithubAdapterPolicy(duplicatePath).trustedUsers()).rejects.toThrow(
      'must not contain duplicates'
    )

    const unknownPath = await writeConfig(
      ['[adapter.github]', 'trusted_users = []', 'token = "not-owned-here"', ''].join('\n')
    )
    await expect(new GithubAdapterPolicy(unknownPath).trustedUsers()).rejects.toThrow(
      'contains unknown fields: token'
    )
  })

  it('registers an exact boolean trust check', async () => {
    const configPath = await writeConfig(
      ['[adapter.github]', 'trusted_users = ["octocat"]', ''].join('\n')
    )
    let tool:
      | {
          name: string
          execute(toolCallId: string, input: { login: string }): Promise<any>
        }
      | undefined
    registerGithubPolicyTool(
      {
        registerTool(candidate) {
          tool = candidate
        },
      } as ExtensionAPI,
      new GithubAdapterPolicy(configPath)
    )

    expect(tool?.name).toBe('check_github_actor_trust')
    await expect(tool?.execute('call_1', { login: 'octocat' })).resolves.toMatchObject({
      details: { login: 'octocat', trusted: true },
    })
  })
})

import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import sessionWorktreeHook, {
  cleanupSessionWorkspace,
  provisionSessionRepoWorktree,
} from '../hooks/session-worktree/main.ts'

type WorkspaceRecord = {
  id: string
  device?: string
  repo: string
  path: string
  branch: string | null
  kind: 'external' | 'root' | 'session'
  ownerKey: string | null
  rootPath: string | null
  managedBy: string | null
}

function createWorkspaceRegistryStub() {
  const records = new Map<string, WorkspaceRecord>()
  return {
    async delete(workspaceId: string) {
      const existing = records.get(workspaceId) ?? null
      records.delete(workspaceId)
      return existing
    },
    async list() {
      return [...records.values()]
    },
    async listForOwner(ownerKey: string) {
      return [...records.values()].filter((workspace) => workspace.ownerKey === ownerKey)
    },
    records,
    async upsert(workspace: WorkspaceRecord) {
      records.set(workspace.id, workspace)
      return workspace
    },
  }
}

function agentHasTool(agentId: string, toolId: string): boolean {
  return agentId === 'dev-neko' && toolId === 'runtime-workspace'
}

function createHookContext(
  dataRoot: string,
  workspace: ReturnType<typeof createWorkspaceRegistryStub>,
  remoteRoots: Record<string, string> = {}
) {
  const withDevice: Parameters<
    typeof provisionSessionRepoWorktree
  >[0]['context']['withDevice'] = async (deviceId, task) => {
    const targetRoot = deviceId ? remoteRoots[deviceId]! : dataRoot
    return await task({
      workspacesRoot: path.join(targetRoot, 'workspaces'),
      exists: async (file) => existsSync(file),
      mkdir: async (dir) => {
        await mkdir(dir, { recursive: true })
      },
      remove: async (file) => {
        await rm(file, { recursive: true, force: true })
      },
      readdir: async (dir) => await readdir(dir),
      execFile: async (command, args, options) => {
        try {
          return (
            await promisify(execFile)(command, args, {
              cwd: options?.cwd,
              env: { ...process.env, ...options?.env },
              encoding: 'utf8',
            })
          ).stdout.trim()
        } catch (error) {
          if (error instanceof Error && 'code' in error && typeof error.code === 'number')
            Object.assign(error, { exitCode: error.code })
          throw error
        }
      },
    })
  }
  return { agentHasTool, workspace, withDevice }
}

async function withBareRepo(fn: (params: { bareRepo: string }) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-worktree-hook-'))
  const sourceRepo = path.join(tempRoot, 'source')
  const bareRepo = path.join(tempRoot, 'remote.git')
  try {
    execFileSync('git', ['init', '--initial-branch', 'main', sourceRepo])
    execFileSync('git', ['config', 'user.name', 'nyako-test'], { cwd: sourceRepo })
    execFileSync('git', ['config', 'user.email', 'nyako-test@example.com'], { cwd: sourceRepo })
    await writeFile(path.join(sourceRepo, 'README.md'), '# hook test\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: sourceRepo })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: sourceRepo })
    execFileSync('git', ['clone', '--bare', sourceRepo, bareRepo])
    await fn({ bareRepo })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

describe('session-worktree hook helpers', () => {
  const cleanupRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      cleanupRoots.splice(0).map(async (dir) => await rm(dir, { recursive: true, force: true }))
    )
  })

  it('provisions and cleans a per-session worktree from a shared repo root', async () => {
    await withBareRepo(async ({ bareRepo }) => {
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-worktree-data-'))
      cleanupRoots.push(dataRoot)
      const workspace = createWorkspaceRegistryStub()
      const context = createHookContext(dataRoot, workspace)

      const sessionWorkspace = await provisionSessionRepoWorktree({
        context,
        remoteUrl: bareRepo,
        repo: 'PaddlePaddle/Paddle',
        sessionId: 'sess_dev_neko_review_paddle',
      })

      expect(sessionWorkspace).not.toBeNull()
      expect(sessionWorkspace?.kind).toBe('session')
      expect(sessionWorkspace?.managedBy).toBe('session-worktree')
      expect(sessionWorkspace?.path).toContain(
        path.join('workspaces', 'sessions', 'sess_dev_neko_review_paddle', 'PaddlePaddle', 'Paddle')
      )
      expect(workspace.records.size).toBe(2)
      await access(sessionWorkspace!.path)

      const readme = await readFile(path.join(sessionWorkspace!.path, 'README.md'), 'utf8')
      expect(readme).toContain('# hook test')

      await cleanupSessionWorkspace({
        context,
        sessionId: 'sess_dev_neko_review_paddle',
        workspace: sessionWorkspace!,
      })

      await expect(access(sessionWorkspace!.path)).rejects.toThrow()
      expect(workspace.records.has(sessionWorkspace!.id)).toBe(false)
    })
  })

  it('skips workspace provisioning for agents without runtime workspace capability', async () => {
    const workspace = createWorkspaceRegistryStub()
    const result = await sessionWorktreeHook.beforeSessionCreate(
      {
        sessionId: 'sess_monitor_neko_review_paddle',
        input: {
          owner: 'monitor-neko',
          artifacts: {
            repos: ['PaddlePaddle/Paddle'],
          },
        },
      },
      createHookContext('/tmp/nyako-worktree-skip', workspace)
    )

    expect(result).toBeUndefined()
    expect(workspace.records.size).toBe(0)
  })

  it('preserves an explicit remote working directory', async () => {
    const workspace = createWorkspaceRegistryStub()
    await sessionWorktreeHook.beforeSessionCreate(
      {
        sessionId: 'sess_remote',
        input: {
          owner: 'dev-neko',
          device: 'test-device',
          cwd: '/explicit/repo',
          artifacts: { repos: ['example/project'] },
        },
      },
      createHookContext('/unused/device-hook-test', workspace)
    )
    expect(workspace.records.size).toBe(0)
  })

  it('cleans tracked manual session workspaces', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-worktree-legacy-'))
    cleanupRoots.push(dataRoot)
    const workspace = createWorkspaceRegistryStub()
    const sessionId = 'sess_dev_neko_legacy_cleanup'
    const legacyPath = path.join(
      dataRoot,
      'workspaces',
      'sessions',
      sessionId,
      'PaddlePaddle',
      'docs'
    )
    await mkdir(legacyPath, { recursive: true })
    await writeFile(path.join(legacyPath, 'README.md'), '# legacy workspace\n', 'utf8')
    await workspace.upsert({
      id: 'ws_paddlepaddle_docs',
      repo: 'PaddlePaddle/docs',
      path: legacyPath,
      branch: 'develop',
      kind: 'session',
      ownerKey: sessionId,
      rootPath: legacyPath,
      managedBy: 'manual',
    })

    await sessionWorktreeHook.onSessionArchived(
      {
        sessionId,
      },
      createHookContext(dataRoot, workspace)
    )

    await expect(access(legacyPath)).rejects.toThrow()
    expect(workspace.records.has('ws_paddlepaddle_docs')).toBe(false)
  })

  it('cleans session state when managed worktree git metadata is broken', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-worktree-broken-'))
    cleanupRoots.push(dataRoot)
    const workspace = createWorkspaceRegistryStub()
    const sessionId = 'sess_dev_neko_broken_worktree'
    const rootPath = path.join(dataRoot, 'workspaces', 'repos', 'ShigureLab', 'gh-llm')
    const sessionPath = path.join(
      dataRoot,
      'workspaces',
      'sessions',
      sessionId,
      'ShigureLab',
      'gh-llm'
    )
    await mkdir(rootPath, { recursive: true })
    await mkdir(sessionPath, { recursive: true })
    await writeFile(path.join(rootPath, '.git'), 'gitdir: /missing/root-worktree\n', 'utf8')
    await writeFile(path.join(sessionPath, '.git'), 'gitdir: /missing/session-worktree\n', 'utf8')
    await workspace.upsert({
      id: 'ws_root_shigurelab_gh_llm',
      repo: 'ShigureLab/gh-llm',
      path: rootPath,
      branch: 'main',
      kind: 'root',
      ownerKey: null,
      rootPath,
      managedBy: 'session-worktree',
    })
    const sessionWorkspace = await workspace.upsert({
      id: 'ws_session_broken_shigurelab_gh_llm',
      repo: 'ShigureLab/gh-llm',
      path: sessionPath,
      branch: 'session/sess_dev_neko_broken_worktree',
      kind: 'session',
      ownerKey: sessionId,
      rootPath,
      managedBy: 'session-worktree',
    })

    await sessionWorktreeHook.onSessionArchived(
      {
        sessionId,
      },
      createHookContext(dataRoot, workspace)
    )

    await expect(access(sessionPath)).rejects.toThrow()
    await expect(access(path.join(dataRoot, 'workspaces', 'sessions', sessionId))).rejects.toThrow()
    await expect(access(rootPath)).rejects.toThrow()
    expect(workspace.records.has(sessionWorkspace.id)).toBe(false)
    expect(workspace.records.has('ws_root_shigurelab_gh_llm')).toBe(false)
  })

  it('cleans session workspaces after a session is removed', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-worktree-removed-'))
    cleanupRoots.push(dataRoot)
    const workspace = createWorkspaceRegistryStub()
    const sessionId = 'sess_dev_neko_removed_cleanup'
    const sessionPath = path.join(
      dataRoot,
      'workspaces',
      'sessions',
      sessionId,
      'ShigureLab',
      'nyako'
    )
    await mkdir(sessionPath, { recursive: true })
    await workspace.upsert({
      id: 'ws_session_removed_shigurelab_nyako',
      repo: 'ShigureLab/nyako',
      path: sessionPath,
      branch: null,
      kind: 'session',
      ownerKey: sessionId,
      rootPath: null,
      managedBy: 'manual',
    })

    await sessionWorktreeHook.onSessionRemoved(
      { sessionId },
      createHookContext(dataRoot, workspace)
    )

    await expect(access(sessionPath)).rejects.toThrow()
    expect(workspace.records.has('ws_session_removed_shigurelab_nyako')).toBe(false)
  })

  it('clones and creates worktrees on the selected device, with distinct shared roots per device', async () => {
    await withBareRepo(async ({ bareRepo }) => {
      const localRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-local-workspaces-'))
      const remoteRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-remote-workspaces-'))
      cleanupRoots.push(localRoot, remoteRoot)
      const workspace = createWorkspaceRegistryStub()
      const context = createHookContext(localRoot, workspace, { builder: remoteRoot })
      const local = await provisionSessionRepoWorktree({
        context,
        remoteUrl: bareRepo,
        repo: 'example/project',
        sessionId: 'local',
      })
      const remote = await provisionSessionRepoWorktree({
        context,
        device: 'builder',
        remoteUrl: bareRepo,
        repo: 'example/project',
        sessionId: 'remote',
      })
      expect(local.path).toContain(localRoot)
      expect(remote.path).toContain(remoteRoot)
      expect(remote.device).toBe('builder')
      expect((await workspace.list()).filter((item) => item.kind === 'root')).toHaveLength(2)
      expect(await readFile(path.join(remote.path, 'README.md'), 'utf8')).toContain('# hook test')
      await sessionWorktreeHook.onSessionArchived({ sessionId: 'remote' }, context)
      await expect(access(remote.path)).rejects.toThrow()
      await access(local.path)
    })
  })

  it('isolates the same repository and Session id in separate project workspaces', async () => {
    await withBareRepo(async ({ bareRepo }) => {
      const deviceRoot = await mkdtemp(path.join(os.tmpdir(), 'nyako-project-workspaces-'))
      cleanupRoots.push(deviceRoot)
      const contexts = ['first-project', 'second-project'].map((project) =>
        createHookContext(path.join(deviceRoot, 'projects', project), createWorkspaceRegistryStub())
      )
      const workspaces = []
      for (const context of contexts) {
        workspaces.push(
          await provisionSessionRepoWorktree({
            context,
            remoteUrl: bareRepo,
            repo: 'example/project',
            sessionId: 'same-session',
          })
        )
      }
      expect(workspaces[0]!.rootPath).not.toBe(workspaces[1]!.rootPath)
      await writeFile(path.join(workspaces[1]!.path, 'proof.txt'), 'second project')
      await sessionWorktreeHook.onSessionArchived({ sessionId: 'same-session' }, contexts[0]!)
      await expect(access(workspaces[0]!.path)).rejects.toThrow()
      expect(await readFile(path.join(workspaces[1]!.path, 'proof.txt'), 'utf8')).toBe(
        'second project'
      )
      expect(await contexts[1]!.workspace.listForOwner('same-session')).toHaveLength(1)
    })
  })
})

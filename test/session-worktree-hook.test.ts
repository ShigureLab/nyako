import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import sessionWorktreeHook, {
  cleanupSessionWorkspace,
  provisionSessionRepoWorktree,
} from '../hooks/session-worktree/main.ts'

type WorkspaceRecord = {
  id: string
  repo: string
  path: string
  branch: string | null
  dirty: boolean
  kind?: 'legacy' | 'root' | 'session'
  currentSessionId: string | null
  rootPath?: string | null
  managedBy?: string | null
}

function createWorkspaceRegistryStub() {
  const records = new Map<string, WorkspaceRecord>()
  return {
    async deleteWorkspace(workspaceId: string) {
      const existing = records.get(workspaceId) ?? null
      records.delete(workspaceId)
      return existing
    },
    async listWorkspaces() {
      return [...records.values()]
    },
    async listSessionWorkspaces(sessionId: string) {
      return [...records.values()].filter((workspace) => workspace.currentSessionId === sessionId)
    },
    records,
    async upsertWorkspace(workspace: WorkspaceRecord) {
      records.set(workspace.id, workspace)
      return workspace
    },
  }
}

function createRuntimeConfigStub() {
  return {
    agents: new Map<string, { tools: string[] }>([
      ['dev-neko', { tools: ['runtime-workspace'] }],
      ['monitor-neko', { tools: ['runtime-task'] }],
    ]),
  }
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
      const context = {
        dataRoot,
        runtimeConfig: createRuntimeConfigStub(),
        workspace,
      }

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
      {
        dataRoot: '/tmp/nyako-worktree-skip',
        runtimeConfig: createRuntimeConfigStub(),
        workspace,
      }
    )

    expect(result).toBeUndefined()
    expect(workspace.records.size).toBe(0)
  })

  it('cleans legacy manual session workspaces under the session workspace root', async () => {
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
    await workspace.upsertWorkspace({
      id: 'ws_paddlepaddle_docs',
      repo: 'PaddlePaddle/docs',
      path: legacyPath,
      branch: 'develop',
      dirty: false,
      kind: 'session',
      currentSessionId: null,
      rootPath: legacyPath,
      managedBy: 'manual',
    })

    await sessionWorktreeHook.beforeSessionArchive(
      {
        session: {
          id: sessionId,
        },
      },
      {
        dataRoot,
        runtimeConfig: createRuntimeConfigStub(),
        workspace,
      }
    )

    await expect(access(legacyPath)).rejects.toThrow()
    expect(workspace.records.has('ws_paddlepaddle_docs')).toBe(false)
  })
})

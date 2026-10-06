import path from 'node:path'

const HOOK_ID = 'session-worktree'

type SessionCreateInput = {
  owner: string
  device?: string
  cwd?: string
  artifacts?: { repos?: string[] }
}

type WorkspaceRecord = {
  id: string
  device?: string
  repo: string
  path: string
  branch: string | null
  ownerKey: string | null
  kind: 'external' | 'root' | 'session'
  rootPath: string | null
  managedBy: string | null
}

type WorkspaceRegistryLike = {
  delete(workspaceId: string): Promise<WorkspaceRecord | null>
  list(): Promise<WorkspaceRecord[]>
  listForOwner(ownerKey: string): Promise<WorkspaceRecord[]>
  upsert(workspace: WorkspaceRecord): Promise<WorkspaceRecord>
}

type WorkspaceDevice = {
  workspacesRoot: string
  exists(file: string): Promise<boolean>
  mkdir(dir: string): Promise<void>
  remove(file: string): Promise<void>
  readdir(dir: string): Promise<string[]>
  execFile(
    command: string,
    args: string[],
    options?: {
      cwd?: string
      env?: Record<string, string>
    }
  ): Promise<string>
}

type HookContext = {
  agentHasTool(agentId: string, toolId: string): boolean
  workspace: WorkspaceRegistryLike
  withDevice<T>(
    deviceId: string | undefined,
    task: (device: WorkspaceDevice) => Promise<T>
  ): Promise<T>
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseRepoSlug(repo: string): { owner: string; repoName: string } | null {
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(repo.trim().replace(/\.git$/i, ''))
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..')
    return null
  return { owner: match[1]!, repoName: match[2]! }
}

export function buildRootWorkspaceId(repo: string, device?: string): string {
  return device
    ? `ws_remote_root_${encodeURIComponent(device)}_${slugify(repo)}`
    : `ws_root_${slugify(repo)}`
}

export function buildSessionWorkspaceId(sessionId: string, repo: string): string {
  return `ws_session_${slugify(sessionId)}_${slugify(repo)}`
}

export function buildSessionBranch(sessionId: string): string {
  return `session/${slugify(sessionId) || 'work'}`
}

export function buildRepoPaths(params: {
  workspacesRoot: string
  repo: string
  sessionId: string
}) {
  const parsed = parseRepoSlug(params.repo)
  if (!parsed) return null
  return {
    rootPath: path.posix.join(params.workspacesRoot, 'repos', parsed.owner, parsed.repoName),
    sessionPath: path.posix.join(
      params.workspacesRoot,
      'sessions',
      params.sessionId,
      parsed.owner,
      parsed.repoName
    ),
  }
}

async function execGit(fs: WorkspaceDevice, args: string[], cwd?: string): Promise<string> {
  return await fs.execFile('git', args, { cwd, env: { GIT_TERMINAL_PROMPT: '0' } })
}

async function readGit(fs: WorkspaceDevice, args: string[], cwd?: string): Promise<string | null> {
  try {
    return await execGit(fs, args, cwd)
  } catch (error) {
    if (error instanceof Error && 'exitCode' in error) return null
    throw error
  }
}

async function isUsableGitWorktree(fs: WorkspaceDevice, worktreePath: string): Promise<boolean> {
  return (
    (await fs.exists(worktreePath)) &&
    (await readGit(fs, ['rev-parse', '--is-inside-work-tree'], worktreePath)) === 'true'
  )
}

async function ensureSharedRepoRoot(params: {
  fs: WorkspaceDevice
  remoteUrl?: string
  repo: string
  rootPath: string
}): Promise<{ branch: string; rootPath: string }> {
  const { fs, rootPath } = params
  await fs.mkdir(path.posix.dirname(rootPath))
  if (
    (await fs.exists(path.posix.join(rootPath, '.git'))) &&
    !(await isUsableGitWorktree(fs, rootPath))
  ) {
    await fs.remove(rootPath)
  }
  if (!(await fs.exists(path.posix.join(rootPath, '.git')))) {
    await execGit(fs, [
      'clone',
      params.remoteUrl?.trim() || `https://github.com/${params.repo}.git`,
      rootPath,
    ])
  }
  const dirty = await execGit(fs, ['status', '--porcelain'], rootPath)
  if (dirty)
    throw new Error(`shared repo root is dirty and cannot be refreshed safely: ${rootPath}`)
  await execGit(fs, ['fetch', 'origin', '--prune'], rootPath)
  const originHead = (
    await readGit(fs, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], rootPath)
  )?.replace(/^origin\//, '')
  const branch = originHead || (await readGit(fs, ['branch', '--show-current'], rootPath)) || 'main'
  await execGit(fs, ['checkout', branch], rootPath)
  await execGit(fs, ['reset', '--hard', `origin/${branch}`], rootPath)
  return { branch, rootPath }
}

async function removeEmptyParents(
  fs: WorkspaceDevice,
  startDir: string,
  stopDir: string
): Promise<void> {
  let current = path.posix.resolve(startDir)
  const boundary = path.posix.resolve(stopDir)
  while (current.startsWith(`${boundary}/`) && current !== boundary) {
    if (await fs.exists(current)) {
      if ((await fs.readdir(current)).length > 0) return
      await fs.remove(current)
    }
    current = path.posix.dirname(current)
  }
}

async function provisionRepo(params: {
  context: HookContext
  fs: WorkspaceDevice
  device?: string
  remoteUrl?: string
  repo: string
  sessionId: string
}): Promise<WorkspaceRecord> {
  const paths = buildRepoPaths({
    workspacesRoot: params.fs.workspacesRoot,
    repo: params.repo,
    sessionId: params.sessionId,
  })
  if (!paths) throw new Error(`invalid repository: ${params.repo}`)
  const { fs } = params
  const root = await ensureSharedRepoRoot({ ...params, rootPath: paths.rootPath })
  const branch = buildSessionBranch(params.sessionId)
  await fs.remove(paths.sessionPath)
  await fs.mkdir(path.posix.dirname(paths.sessionPath))
  await execGit(fs, ['worktree', 'prune'], root.rootPath)
  await execGit(
    fs,
    ['worktree', 'add', '-B', branch, paths.sessionPath, `origin/${root.branch}`],
    root.rootPath
  )
  const target = params.device ? { device: params.device } : {}
  await params.context.workspace.upsert({
    id: buildRootWorkspaceId(params.repo, params.device),
    ...target,
    repo: params.repo,
    path: root.rootPath,
    branch: root.branch,
    kind: 'root',
    ownerKey: null,
    rootPath: root.rootPath,
    managedBy: HOOK_ID,
  })
  return await params.context.workspace.upsert({
    id: buildSessionWorkspaceId(params.sessionId, params.repo),
    ...target,
    repo: params.repo,
    path: paths.sessionPath,
    branch,
    kind: 'session',
    ownerKey: params.sessionId,
    rootPath: root.rootPath,
    managedBy: HOOK_ID,
  })
}

export async function provisionSessionRepoWorktree(params: {
  context: HookContext
  device?: string
  remoteUrl?: string
  repo: string
  sessionId: string
}): Promise<WorkspaceRecord> {
  return await params.context.withDevice(
    params.device,
    async (fs) => await provisionRepo({ ...params, fs })
  )
}

async function cleanupWorkspace(params: {
  context: HookContext
  fs: WorkspaceDevice
  sessionId: string
  workspace: WorkspaceRecord
}): Promise<void> {
  const { fs, workspace } = params
  const rootPath = workspace.rootPath?.trim() || null
  const isManaged = workspace.managedBy === HOOK_ID && rootPath && rootPath !== workspace.path
  const usableRoot = rootPath ? await isUsableGitWorktree(fs, rootPath) : false
  if (isManaged && rootPath && usableRoot) {
    await execGit(fs, ['worktree', 'remove', '--force', workspace.path], rootPath)
    await execGit(fs, ['worktree', 'prune'], rootPath)
    if (workspace.branch) await readGit(fs, ['branch', '-D', workspace.branch], rootPath)
  } else {
    await fs.remove(workspace.path)
  }
  await params.context.workspace.delete(workspace.id)
  await removeEmptyParents(
    fs,
    path.posix.dirname(workspace.path),
    path.posix.join(fs.workspacesRoot, 'sessions')
  )
  if (isManaged && rootPath && !usableRoot) {
    const remaining = (await params.context.workspace.list()).filter(
      (item) => item.device === workspace.device
    )
    if (!remaining.some((item) => item.kind === 'session' && item.rootPath === rootPath)) {
      await fs.remove(rootPath)
      const root = remaining.find(
        (item) => item.kind === 'root' && item.managedBy === HOOK_ID && item.path === rootPath
      )
      if (root) await params.context.workspace.delete(root.id)
      await removeEmptyParents(
        fs,
        path.posix.dirname(rootPath),
        path.posix.join(fs.workspacesRoot, 'repos')
      )
    }
  }
}

export async function cleanupSessionWorkspace(params: {
  context: HookContext
  sessionId: string
  workspace: WorkspaceRecord
}): Promise<void> {
  await params.context.withDevice(
    params.workspace.device,
    async (fs) => await cleanupWorkspace({ ...params, fs })
  )
}

async function cleanupManagedSessionWorkspaces(
  context: HookContext,
  sessionId: string
): Promise<void> {
  for (const workspace of await context.workspace.listForOwner(sessionId)) {
    if (workspace.kind === 'session')
      await cleanupSessionWorkspace({ context, sessionId, workspace })
  }
}

const sessionWorktreeHook = {
  async beforeSessionCreate(
    event: { input: SessionCreateInput; sessionId: string },
    context: HookContext
  ): Promise<{ cwd: string } | void> {
    if (!context.agentHasTool(event.input.owner, 'runtime-workspace') || event.input.cwd) return
    const repos = [
      ...new Set(event.input.artifacts?.repos?.map((repo) => repo.trim()) ?? []),
    ].filter(Boolean)
    if (!repos.length) return
    return await context.withDevice(event.input.device, async (fs) => {
      let first: WorkspaceRecord | null = null
      for (const repo of repos) {
        const workspace = await provisionRepo({
          context,
          fs,
          device: event.input.device,
          repo,
          sessionId: event.sessionId,
        })
        first ??= workspace
      }
      return event.input.device && first ? { cwd: first.path } : undefined
    })
  },
  async onSessionArchived(event: { sessionId: string }, context: HookContext) {
    await cleanupManagedSessionWorkspaces(context, event.sessionId)
  },
  async onSessionRemoved(event: { sessionId: string }, context: HookContext) {
    await cleanupManagedSessionWorkspaces(context, event.sessionId)
  },
}

export default sessionWorktreeHook

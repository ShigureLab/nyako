import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const HOOK_ID = 'session-worktree'

type SessionCreateInput = {
  owner: string
  artifacts?: {
    repos?: string[]
  }
  workspace?: string | null
}

type SessionRecord = {
  id: string
}

type WorkspaceRecord = {
  id: string
  repo: string
  path: string
  branch: string | null
  currentSessionId: string | null
  kind?: 'legacy' | 'root' | 'session'
  rootPath?: string | null
  managedBy?: string | null
}

type WorkspaceRegistryLike = {
  deleteWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>
  listSessionWorkspaces(sessionId: string): Promise<WorkspaceRecord[]>
  upsertWorkspace(workspace: Omit<WorkspaceRecord, 'updatedAt'>): Promise<WorkspaceRecord>
}

type HookContext = {
  dataRoot: string
  runtimeConfig: {
    agents: Map<string, { tools: string[] }>
  }
  workspace: WorkspaceRegistryLike
}

function shouldProvisionSessionWorkspace(
  event: { input: SessionCreateInput },
  context: HookContext
): boolean {
  const agent = context.runtimeConfig.agents.get(event.input.owner)
  return Array.isArray(agent?.tools) && agent.tools.includes('runtime-workspace')
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseRepoSlug(repo: string): { owner: string; repoName: string } | null {
  const trimmed = repo.trim().replace(/\.git$/i, '')
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(trimmed)
  if (!match) {
    return null
  }
  return {
    owner: match[1]!,
    repoName: match[2]!,
  }
}

function resolveRemoteUrl(repo: string, remoteUrl?: string): string {
  if (remoteUrl?.trim()) {
    return remoteUrl
  }
  return `https://github.com/${repo}.git`
}

export function buildRootWorkspaceId(repo: string): string {
  return `ws_root_${slugify(repo)}`
}

export function buildSessionWorkspaceId(sessionId: string, repo: string): string {
  return `ws_session_${slugify(sessionId)}_${slugify(repo)}`
}

export function buildSessionBranch(sessionId: string): string {
  const suffix = slugify(sessionId)
  return `session/${suffix || 'work'}`
}

export function buildRepoPaths(params: { dataRoot: string; repo: string; sessionId: string }) {
  const parsed = parseRepoSlug(params.repo)
  if (!parsed) {
    return null
  }
  const rootPath = path.join(params.dataRoot, 'workspaces', 'repos', parsed.owner, parsed.repoName)
  const sessionPath = path.join(
    params.dataRoot,
    'workspaces',
    'sessions',
    params.sessionId,
    parsed.owner,
    parsed.repoName
  )
  return {
    owner: parsed.owner,
    repoName: parsed.repoName,
    rootPath,
    sessionPath,
  }
}

async function execGit(args: string[], cwd?: string): Promise<string> {
  const result = await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  return result.stdout.trim()
}

async function readGit(args: string[], cwd?: string): Promise<string | null> {
  try {
    return await execGit(args, cwd)
  } catch {
    return null
  }
}

async function ensureSharedRepoRoot(params: {
  remoteUrl?: string
  repo: string
  rootPath: string
}): Promise<{ branch: string; rootPath: string }> {
  await mkdir(path.dirname(params.rootPath), { recursive: true })
  if (!existsSync(path.join(params.rootPath, '.git'))) {
    await execGit(['clone', resolveRemoteUrl(params.repo, params.remoteUrl), params.rootPath])
  }

  const dirty = await readGit(['status', '--porcelain'], params.rootPath)
  if (dirty && dirty.trim()) {
    throw new Error(`shared repo root is dirty and cannot be refreshed safely: ${params.rootPath}`)
  }

  await execGit(['fetch', 'origin', '--prune'], params.rootPath)
  const originHead =
    (
      await readGit(
        ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
        params.rootPath
      )
    )
      ?.replace(/^origin\//, '')
      .trim() || null
  const currentBranch =
    (await readGit(['branch', '--show-current'], params.rootPath))?.trim() || null
  const branch = originHead || currentBranch || 'main'
  await execGit(['checkout', branch], params.rootPath)
  await execGit(['reset', '--hard', `origin/${branch}`], params.rootPath)

  return {
    branch,
    rootPath: params.rootPath,
  }
}

async function removeDirIfExists(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    return
  }
  await rm(dirPath, { force: true, recursive: true })
}

async function removeEmptyParents(startDir: string, stopDir: string): Promise<void> {
  let current = path.resolve(startDir)
  const boundary = path.resolve(stopDir)
  while (current.startsWith(boundary) && current !== boundary) {
    const entries = await readdir(current).catch(() => [])
    if (entries.length > 0) {
      return
    }
    await rm(current, { recursive: true, force: true })
    current = path.dirname(current)
  }
}

async function ensureSessionWorktree(params: {
  branch: string
  remoteBaseBranch: string
  rootPath: string
  sessionPath: string
}): Promise<void> {
  await removeDirIfExists(params.sessionPath)
  await mkdir(path.dirname(params.sessionPath), { recursive: true })
  await execGit(['worktree', 'prune'], params.rootPath)
  await execGit(
    [
      'worktree',
      'add',
      '-B',
      params.branch,
      params.sessionPath,
      `origin/${params.remoteBaseBranch}`,
    ],
    params.rootPath
  )
}

export async function provisionSessionRepoWorktree(params: {
  context: HookContext
  remoteUrl?: string
  repo: string
  sessionId: string
}): Promise<WorkspaceRecord | null> {
  const paths = buildRepoPaths({
    dataRoot: params.context.dataRoot,
    repo: params.repo,
    sessionId: params.sessionId,
  })
  if (!paths) {
    return null
  }

  const root = await ensureSharedRepoRoot({
    remoteUrl: params.remoteUrl,
    repo: params.repo,
    rootPath: paths.rootPath,
  })
  const branch = buildSessionBranch(params.sessionId)
  await ensureSessionWorktree({
    branch,
    remoteBaseBranch: root.branch,
    rootPath: root.rootPath,
    sessionPath: paths.sessionPath,
  })

  await params.context.workspace.upsertWorkspace({
    id: buildRootWorkspaceId(params.repo),
    repo: params.repo,
    path: root.rootPath,
    branch: root.branch,
    dirty: false,
    kind: 'root',
    currentSessionId: null,
    rootPath: root.rootPath,
    managedBy: HOOK_ID,
  })

  return await params.context.workspace.upsertWorkspace({
    id: buildSessionWorkspaceId(params.sessionId, params.repo),
    repo: params.repo,
    path: paths.sessionPath,
    branch,
    dirty: false,
    kind: 'session',
    currentSessionId: params.sessionId,
    rootPath: root.rootPath,
    managedBy: HOOK_ID,
  })
}

export async function cleanupSessionWorkspace(params: {
  context: HookContext
  sessionId: string
  workspace: WorkspaceRecord
}): Promise<void> {
  const rootPath = params.workspace.rootPath?.trim() || null
  const branch = params.workspace.branch?.trim() || null

  if (rootPath && existsSync(rootPath)) {
    await readGit(['worktree', 'remove', '--force', params.workspace.path], rootPath)
    await execGit(['worktree', 'prune'], rootPath)
    if (branch) {
      await readGit(['branch', '-D', branch], rootPath)
    }
  } else {
    await removeDirIfExists(params.workspace.path)
  }

  await params.context.workspace.deleteWorkspace(params.workspace.id)
  await removeEmptyParents(
    path.dirname(params.workspace.path),
    path.join(params.context.dataRoot, 'workspaces', 'sessions', params.sessionId)
  )
  await removeEmptyParents(
    path.join(params.context.dataRoot, 'workspaces', 'sessions', params.sessionId),
    path.join(params.context.dataRoot, 'workspaces', 'sessions')
  )
}

async function cleanupManagedSessionWorkspaces(params: {
  context: HookContext
  session: SessionRecord
}): Promise<void> {
  const workspaces = await params.context.workspace.listSessionWorkspaces(params.session.id)
  for (const workspace of workspaces) {
    if (workspace.managedBy !== HOOK_ID || workspace.kind !== 'session') {
      continue
    }
    await cleanupSessionWorkspace({
      context: params.context,
      sessionId: params.session.id,
      workspace,
    })
  }
}

const sessionWorktreeHook = {
  async beforeSessionCreate(
    event: { input: SessionCreateInput; sessionId: string },
    context: HookContext
  ) {
    if (!shouldProvisionSessionWorkspace(event, context)) {
      return undefined
    }
    const repos = Array.from(
      new Set(event.input.artifacts?.repos?.map((repo) => repo.trim()) ?? [])
    ).filter(Boolean)
    if (repos.length === 0) {
      return undefined
    }

    let primaryWorkspaceId: string | null = null
    for (const repo of repos) {
      const workspace = await provisionSessionRepoWorktree({
        context,
        repo,
        sessionId: event.sessionId,
      })
      if (!primaryWorkspaceId && workspace) {
        primaryWorkspaceId = workspace.id
      }
    }

    return primaryWorkspaceId
      ? {
          workspace: primaryWorkspaceId,
        }
      : undefined
  },

  async beforeSessionArchive(event: { session: SessionRecord }, context: HookContext) {
    await cleanupManagedSessionWorkspaces({
      context,
      session: event.session,
    })
  },

  async beforeSessionRemove(event: { session: SessionRecord }, context: HookContext) {
    await cleanupManagedSessionWorkspaces({
      context,
      session: event.session,
    })
  },
}

export default sessionWorktreeHook

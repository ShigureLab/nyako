import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'

export type LocalConfigNamespace = 'adapter' | 'tool'

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function table(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a TOML table`)
  }
  return value as Record<string, unknown>
}

export function resolveLocalConfigPath(
  homeDir = os.homedir(),
  env: Record<string, string | undefined> = process.env
): string {
  const configuredPath = env.NYAKORE_CONFIG_PATH?.trim()
  if (configuredPath) return path.resolve(configuredPath)
  return path.join(homeDir, '.nyakore', 'config.toml')
}

export async function loadLocalConfigSection(
  namespace: LocalConfigNamespace,
  name: string,
  configPath = resolveLocalConfigPath()
): Promise<Record<string, unknown> | null> {
  let source: string
  try {
    source = await readFile(configPath, 'utf8')
  } catch (error) {
    if (isMissingPath(error)) return null
    throw error
  }
  const root = table(parseToml(source), configPath)
  if (root[namespace] === undefined) return null
  const sections = table(root[namespace], `${configPath}: [${namespace}]`)
  if (sections[name] === undefined) return null
  return table(sections[name], `${configPath}: [${namespace}.${name}]`)
}

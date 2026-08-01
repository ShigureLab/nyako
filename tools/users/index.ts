import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type, type Static } from '@sinclair/typebox'
import { parse as parseToml } from 'smol-toml'

export type UserBinding = {
  id: string
  canonicalIdentity: string
  identities: string[]
  notificationPeerId: string | null
}

const resolveUserBindingSchema = Type.Object(
  {
    identity: Type.String({ minLength: 1, description: 'Stable external identity to resolve.' }),
  },
  { additionalProperties: false }
)

type ResolveUserBindingInput = Static<typeof resolveUserBindingSchema>

const DEFAULT_BINDINGS_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'bindings'
)

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function parseBinding(raw: unknown, filePath: string): UserBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${filePath} must contain a TOML table`)
  }
  const value = raw as Record<string, unknown>
  const unknownFields = Object.keys(value).filter(
    (key) => key !== 'id' && key !== 'identities' && key !== 'notificationPeerId'
  )
  if (unknownFields.length > 0) {
    throw new Error(`${filePath} contains unknown fields: ${unknownFields.join(', ')}`)
  }
  const id = nonEmptyString(value.id, `${filePath}: id`)
  if (!Array.isArray(value.identities) || value.identities.length === 0) {
    throw new Error(`${filePath}: identities must be a non-empty string array`)
  }
  const identities = value.identities.map((identity, index) =>
    nonEmptyString(identity, `${filePath}: identities[${index}]`)
  )
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${filePath}: identities must not contain duplicates`)
  }
  const notificationPeerId =
    value.notificationPeerId === undefined
      ? null
      : nonEmptyString(value.notificationPeerId, `${filePath}: notificationPeerId`)
  if (notificationPeerId) {
    const match = /^endpoint:([^:]+):(.+)$/.exec(notificationPeerId)
    const driver = match?.[1] ?? ''
    const identity = match?.[2] ?? ''
    if (!identities.includes(identity) || !identity.startsWith(`${driver}:`)) {
      throw new Error(
        `${filePath}: notificationPeerId driver must match an explicitly bound identity`
      )
    }
  }
  const canonicalIdentity = `user:${id}`
  if (identities.includes(canonicalIdentity)) {
    throw new Error(
      `${filePath}: identities must not repeat the implicit canonical identity ${canonicalIdentity}`
    )
  }
  return { id, canonicalIdentity, identities, notificationPeerId }
}

export class UserBindingDirectory {
  readonly directory: string

  constructor(directory = DEFAULT_BINDINGS_DIRECTORY) {
    this.directory = directory
  }

  async list(): Promise<UserBinding[]> {
    let entries
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch (error) {
      if (isMissingPath(error)) return []
      throw error
    }

    const bindings = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const filePath = path.join(this.directory, entry.name)
          try {
            return parseBinding(parseToml(await readFile(filePath, 'utf8')), filePath)
          } catch (error) {
            throw new Error(
              `failed to load user binding: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error }
            )
          }
        })
    )

    const ids = new Set<string>()
    const identityOwners = new Map<string, string>()
    for (const binding of bindings) {
      if (ids.has(binding.id)) {
        throw new Error(`duplicate user id ${JSON.stringify(binding.id)}`)
      }
      ids.add(binding.id)
      for (const identity of [binding.canonicalIdentity, ...binding.identities]) {
        const owner = identityOwners.get(identity)
        if (owner && owner !== binding.id) {
          throw new Error(
            `identity ${JSON.stringify(identity)} is bound to both ${JSON.stringify(owner)} and ${JSON.stringify(binding.id)}`
          )
        }
        identityOwners.set(identity, binding.id)
      }
    }
    return bindings
  }

  async resolve(identity: string): Promise<UserBinding | null> {
    const target = nonEmptyString(identity, 'identity')
    return (
      (await this.list()).find(
        (binding) => binding.canonicalIdentity === target || binding.identities.includes(target)
      ) ?? null
    )
  }
}

export default function registerUserBindingTool(pi: ExtensionAPI): void {
  const users = new UserBindingDirectory()
  pi.registerTool({
    name: 'resolve_user_binding',
    label: 'resolve user binding',
    description:
      'Resolve an explicitly configured full external identity and its optional notification peer from the definition-owned user binding group exposed to Hub. For a GitHub sourceEvent.actorLogin, pass github:user:<login>; bare logins never match.',
    parameters: resolveUserBindingSchema,
    execute: async (_toolCallId, input: ResolveUserBindingInput) => {
      const binding = await users.resolve(input.identity)
      const details = binding
        ? {
            found: true,
            id: binding.id,
            canonicalIdentity: binding.canonicalIdentity,
            identities: binding.identities,
            notificationPeerId: binding.notificationPeerId,
          }
        : { found: false, identity: input.identity.trim() }
      return {
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
      }
    },
  })
}

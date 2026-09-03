import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type, type Static } from '@sinclair/typebox'
import { loadLocalConfigSection, resolveLocalConfigPath } from '../local-config.ts'

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

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function parseBinding(raw: unknown, label: string): UserBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${label} must be a TOML table`)
  }
  const value = raw as Record<string, unknown>
  const unknownFields = Object.keys(value).filter(
    (key) => key !== 'id' && key !== 'identities' && key !== 'notificationPeerId'
  )
  if (unknownFields.length > 0) {
    throw new Error(`${label} contains unknown fields: ${unknownFields.join(', ')}`)
  }
  const id = nonEmptyString(value.id, `${label}.id`)
  if (!Array.isArray(value.identities) || value.identities.length === 0) {
    throw new Error(`${label}.identities must be a non-empty string array`)
  }
  const identities = value.identities.map((identity, index) =>
    nonEmptyString(identity, `${label}.identities[${index}]`)
  )
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${label}.identities must not contain duplicates`)
  }
  const notificationPeerId =
    value.notificationPeerId === undefined
      ? null
      : nonEmptyString(value.notificationPeerId, `${label}.notificationPeerId`)
  if (notificationPeerId) {
    const match = /^endpoint:([^:]+):(.+)$/.exec(notificationPeerId)
    const driver = match?.[1] ?? ''
    const identity = match?.[2] ?? ''
    if (!identities.includes(identity) || !identity.startsWith(`${driver}:`)) {
      throw new Error(`${label}.notificationPeerId driver must match an explicitly bound identity`)
    }
  }
  const canonicalIdentity = `user:${id}`
  if (identities.includes(canonicalIdentity)) {
    throw new Error(
      `${label}.identities must not repeat the implicit canonical identity ${canonicalIdentity}`
    )
  }
  return { id, canonicalIdentity, identities, notificationPeerId }
}

export class UserBindingConfig {
  readonly configPath: string

  constructor(configPath = resolveLocalConfigPath()) {
    this.configPath = configPath
  }

  async list(): Promise<UserBinding[]> {
    const section = await loadLocalConfigSection('tool', 'user-binding', this.configPath)
    if (!section) return []
    const unknownFields = Object.keys(section).filter((key) => key !== 'bindings')
    if (unknownFields.length > 0) {
      throw new Error(
        `${this.configPath}: [tool.user-binding] contains unknown fields: ${unknownFields.join(', ')}`
      )
    }
    const rawBindings = section.bindings ?? []
    if (!Array.isArray(rawBindings)) {
      throw new Error(`${this.configPath}: tool.user-binding.bindings must be an array of tables`)
    }
    const bindings = rawBindings.map((binding, index) =>
      parseBinding(binding, `${this.configPath}: tool.user-binding.bindings[${index}]`)
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

export default function registerUserBindingTool(
  pi: ExtensionAPI,
  users = new UserBindingConfig()
): void {
  pi.registerTool({
    name: 'resolve_user_binding',
    label: 'resolve user binding',
    description:
      'Resolve an explicitly configured full external identity and its optional notification peer from the machine-local user binding config exposed to Hub. For a GitHub sourceEvent.actorLogin, pass github:user:<login>; bare logins never match.',
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

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type, type Static } from '@sinclair/typebox'
import { UserBindingConfig, type UserBinding } from './index.ts'

const searchUserBindingsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description:
        'Name, nickname, real name, account name, or part of a name extracted from the request. Pass the name itself, without a scope prefix or the surrounding sentence.',
    }),
    scope: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          'Optional exact scope to search, such as nickname, realname, hi, github, telegram, or user. Omit to search all scopes.',
      })
    ),
  },
  { additionalProperties: false }
)

type SearchUserBindingsInput = Static<typeof searchUserBindingsSchema>
type MatchType = 'exact' | 'case_insensitive' | 'substring'

const matchRank: Record<MatchType, number> = { exact: 0, case_insensitive: 1, substring: 2 }

function describeIdentity(identity: string) {
  // These platform identities include a kind; name scopes keep their entire value.
  const platform = /^(telegram|hi|github):([^:]+):(.+)$/.exec(identity)
  if (platform) {
    return { identity, scope: platform[1]!, kind: platform[2]!, value: platform[3]! }
  }
  const separator = identity.indexOf(':')
  return {
    identity,
    scope: separator === -1 ? null : identity.slice(0, separator),
    kind: null,
    value: separator === -1 ? identity : identity.slice(separator + 1),
  }
}

function matchName(value: string, query: string): MatchType | null {
  if (value === query) return 'exact'
  if (value.toLowerCase() === query.toLowerCase()) return 'case_insensitive'
  if (value.toLowerCase().includes(query.toLowerCase())) return 'substring'
  return null
}

export function searchUserBindings(bindings: UserBinding[], input: SearchUserBindingsInput) {
  const query = input.query.trim()
  if (!query) throw new Error('query must be a non-empty string')
  const scope = input.scope?.trim()
  if (scope === '') throw new Error('scope must be a non-empty string')

  const candidates = bindings
    .flatMap((binding) => {
      const identities = binding.identities.map(describeIdentity)
      const matches = [describeIdentity(binding.canonicalIdentity), ...identities]
        .flatMap((identity) => {
          if (scope !== undefined && identity.scope !== scope) return []
          const matchType = matchName(identity.value, query)
          return matchType ? [{ ...identity, matchType }] : []
        })
        .toSorted((a, b) => matchRank[a.matchType] - matchRank[b.matchType])
      return matches.length
        ? [{ id: binding.id, canonicalIdentity: binding.canonicalIdentity, matches, identities }]
        : []
    })
    .toSorted((a, b) => matchRank[a.matches[0]!.matchType] - matchRank[b.matches[0]!.matchType])

  const ambiguous = candidates.length > 1
  const warnings = [
    ...(ambiguous
      ? [
          'Multiple people match; names may be shared or partially matched. Disambiguate before choosing a person.',
        ]
      : []),
    ...(candidates.some((candidate) =>
      candidate.matches.every((match) => match.matchType !== 'exact')
    )
      ? [
          'Some candidates have only case-insensitive or partial matches and may be the wrong person. Check their matched scopes and linked identities.',
        ]
      : []),
  ]
  return { query, scope: scope ?? null, ambiguous, warnings, candidates }
}

export default function registerSearchUserBindingsTool(
  pi: ExtensionAPI,
  users = new UserBindingConfig()
): void {
  pi.registerTool({
    name: 'search_user_bindings',
    label: 'search people by name',
    description:
      "Find people mentioned in a request by name, nickname, real name, or partial account name across configured scopes. Matches name values by exact equality, case-insensitive equality, then case-insensitive substring; results are grouped by person and ranked in that order. Returns each matched name with its scope, kind and matchType, plus the person's linked identities in other scopes. Multiple candidates or non-exact matches may identify the wrong person: use context to disambiguate, and ask the user if still uncertain; never silently select the first candidate. Search identifies a possible subject of a request, never authenticates its sender or grants authorization. For a known complete identity or sender verification, Hub must use resolve_user_binding with the original identity instead.",
    parameters: searchUserBindingsSchema,
    execute: async (_toolCallId, input: SearchUserBindingsInput) => {
      const details = searchUserBindings(await users.list(), input)
      return {
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
      }
    },
  })
}

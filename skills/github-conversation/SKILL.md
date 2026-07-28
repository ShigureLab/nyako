---
name: github-conversation
description: Read and update GitHub PR and issue conversations with complete context, verifiable claims, and low noise.
metadata:
   primary-tools:
      - gh-llm
      - gh
---

# GitHub Conversation

Use this skill before replying to an issue, review thread, or pull request, and before submitting a
review.

## Read before writing

1. Build a context map: current goal, open requests, decisions already made, linked work.
2. Expand collapsed timeline pages and relevant review threads.
3. For pull requests, inspect checks, mergeability, and unresolved review threads.
4. Reuse the previous `fetched_at` cursor for incremental reads.

```bash
gh-llm pr view <pr> --repo <owner/repo>
gh-llm pr checks --pr <pr> --repo <owner/repo>
gh-llm issue view <issue> --repo <owner/repo>
```

Use `gh-llm` for rich reads and review-thread operations. Use `gh` for simple writes such as a
top-level comment, labels, assignees, reviewers, close/reopen, and merge.

## Reply with evidence

- Keep one reply focused on one intent.
- Distinguish observed facts from intended actions.
- Support technical claims with a path and line, commit, check/log link, or reproduction command.
- State status plainly: fixed, partially fixed, not fixed, or intentionally unchanged.
- Do not claim that a write succeeded until the command returns a success result or object id.

For multi-paragraph Markdown, quotes, lists, suggestions, or code fences, use a body file. Do not
send literal `\n` escape sequences.

```bash
gh pr comment <pr> --repo <owner/repo> --body-file reply.md
gh-llm pr thread-reply <thread-id> --body-file reply.md --pr <pr> --repo <owner/repo>
gh-llm pr review-submit --event COMMENT --body-file reply.md --pr <pr> --repo <owner/repo>
```

## Review workflow

1. Read the whole change and current discussion.
2. Start one review round and add focused inline comments.
3. Check for an existing unresolved thread at the same location before adding a duplicate.
4. Use a suggestion only when the exact replacement is small and unambiguous.
5. Submit one concise review summary after the inline findings.

For large changes, narrow the view deliberately:

```bash
gh-llm pr review-start --pr <pr> --repo <owner/repo> --path 'path/to/file'
gh-llm pr review-start --pr <pr> --repo <owner/repo> --files 6-12
```

## Troubleshooting

When transport or authentication symptoms are unclear, diagnose before guessing:

```bash
gh-llm doctor
gh llm doctor
gh auth status
```

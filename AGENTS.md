# AGENTS.md

## Purpose

`nyako` is the definition repo built on top of `nyakore`.

It owns:

- agent definitions
- prompt assets
- project memory
- schedules
- project tools and skills
- integration adapters and routing policy

It is not the place for:

- session registry internals
- runtime kernel behavior
- terminal host implementation
- protocol transport internals
- credential storage logic

Those belong in `nyakore`.

## Boundary

If a behavior is missing because the runtime lacks a primitive, fix `nyakore`.

Do not paper over runtime gaps here with:

- prompt-only fake state
- duplicated session bookkeeping
- ad-hoc shadow routing systems
- secrets committed into repo files

## Stack

- Package manager: `pnpm`
- Language for executable repo code: `TypeScript`
- Runtime host: `nyakore`
- Check: `vp check`
- Test: `vp test`
- Formatter/lint/test config lives in `vite.config.ts`

## Required Commands

Before wrapping up meaningful changes, run:

```bash
vp check
vp test
```

If a command cannot run, state why.

After meaningful definition changes, do an end-to-end validation against a real `nyakore` runtime with an isolated `NYAKORE_DATA_ROOT`.

If the change touches schedules, tools, routing, or session behavior, prefer validating in `tmux` with separate daemon / interactive panes or equivalent real cross-process flows.

## Commit Rule

All commits created from agent-driven work must use:

```text
<gitmoji> <type>(<scope>): <subject>
```

`scope` is optional. Choose the gitmoji according to its normal meaning on `gitmoji.dev`, and keep the overall style aligned with the existing commit history in this repo.

All commits created from agent-driven work must also include an agent co-author trailer:

```text
Co-authored-by: Codex <codex@openai.com>
```

## Repo Rules

1. Keep runtime-independent policy here; keep runtime primitives in `nyakore`.
2. One agent per directory under `agents/`; do not collapse multiple personas into one folder.
3. Project tools under `tools/` should be small, explicit adapters around repo policy.
4. Skills are optional, on-demand instructions; always-on constraints belong in `AGENTS.md` / `TOOLS.md`.
5. Secrets never live in repo-managed TOML or Markdown; they belong in `~/.nyakore/`.
6. Session continuity is owned by runtime state, not by prompt fiction.
7. If a monitor or integration needs cross-run truth, prefer explicit state files or tools over model memory.
8. Keep definition files deterministic and file-oriented so `nyakore` can assemble prompts predictably.

## Maintenance Rule

Keep this repo tidy:

- remove dead schedules, tools, and prompt fragments
- collapse duplicated policy text
- keep `README.md` and this file aligned with actual behavior
- move any generic capability that no longer belongs here back into `nyakore`

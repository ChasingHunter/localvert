# Contributing

Thanks for looking at Localvert. This is a small, local-first project with a
few hard rules — most contributions are either a new conversion or an
improvement to one that exists, and both have a well-worn path.

## Setup

```sh
pnpm i
pnpm dev
```

`pnpm dev` runs with the COOP/COEP headers `SharedArrayBuffer` needs — some
engines will misbehave without them, so don't swap in a plain static server.

## Definition of Done

```sh
pnpm verify
```

typecheck + lint + test + build, all green. This is the bar for every commit
and every PR, no exceptions. Never `--no-verify`, never skip or `.skip` a
test, never widen a size budget or the CSP to get a build through — fix the
cause instead.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), with scopes
that matter in this repo: `tool`, `engine`, `worker`, `infra`, `ui`. Version
bumps and the changelog are generated from these (release-please, see
[ADR-0004](docs/adr/0004-release-please.md)), so the type has to be right —
a `feat` typed as `chore` silently disappears from the release.

```
feat(tool): add heic to jpg
fix(engine): free ffmpeg heap on cancel
docs: update the converter matrix
```

External PRs are squash-merged, so the **PR title** becomes the commit
message — make it conventional too. CI checks this for you.

## Adding a conversion

Use the `add-converter` skill, or follow
[docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md) by hand. A conversion is a data
file under `src/tools/**` — format in, format out, a zod options schema, a
pipeline of ops — not bespoke code. Routes, option forms, SEO pages and engine
preloads are all derived from it.

## Adding an engine

Use the `add-engine` skill. **License review comes first, before any code.**
Engines are third-party WebAssembly libraries or codecs, and some are
GPL/LGPL — see [ADR-0002](docs/adr/0002-mit-license-gpl-isolation.md) for how
that's kept separate from this repo's MIT code. An engine that fails the
license check doesn't get integrated, however good the demo looks.

## Invariants

These hold for every change, not just new tools — see CLAUDE.md for the full
list:

1. No network I/O with user file data, ever.
2. No decode, encode, or zip work on the main thread — worker only.
3. No engine in the core bundle — dynamic `import()` inside a worker only.
4. Static export only — no API routes, no server components with runtime
   data, no Node built-ins in app code.
5. Core first-load JS budget: 300 KB gzipped.

## Working with AI agents

This project is built largely through AI agents, and that's treated as
ordinary engineering practice here, not a special case.

- [CLAUDE.md](CLAUDE.md) is the entrypoint every agent reads first — commands,
  architecture map, invariants, commit rules.
- `.claude/skills/` packages the repeatable workflows (`add-converter`,
  `add-engine`, `preflight`, `release`) so they run the same way every time.
- `.claude/agents/implementer.md` is the subagent used for scoped,
  fully-specified implementation slices.
- **No AI attribution in commits.** No `Co-Authored-By`, no "Generated with",
  in the trailer or the body. This is a project rule, not a preference.
- Agents are expected to keep `docs/ROADMAP.md` and `docs/adr/` true as they
  work — those files are the project's memory across sessions that share no
  other context.

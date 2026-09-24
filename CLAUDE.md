# Localvert

Local-first file converter: images, video, audio, PDF, documents, compression.
**Files never leave the browser.** Every conversion runs client-side in a Web
Worker via WebAssembly or native browser APIs. Next.js static export, deployed
as a Cloudflare Worker serving static assets. No server, no API routes, no
upload path, no telemetry of file content.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server with COOP/COEP headers (needed for SharedArrayBuffer) |
| `pnpm build` | Static export to `out/` |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7 — the native compiler, named `tsc`) |
| `pnpm lint` / `pnpm lint:fix` | Biome check |
| `pnpm test` | Vitest unit run. Single file: `pnpm test src/lib/registry/registry.test.ts` |
| `pnpm test:changed` | Vitest unit run, changed files only — fast local loop |
| `pnpm test:browser` | Vitest browser mode — worker + wasm integration tests |
| `pnpm e2e` | Playwright against a real built `out/` (server wired up in Phase 0.7) |
| `pnpm gen` | Regenerate `src/tools/index.ts` + `src/lib/engines/manifest.ts` — *lands in Phase 0.4* |
| `pnpm sync-engines` | Copy wasm assets from `node_modules` into `public/engines/` — *lands in Phase 0.7* |
| `pnpm check-sizes` | Core bundle budget + engine-leak gate against a built `out/` |
| `pnpm check` | typecheck + lint + test — the bar for a normal commit |
| **`pnpm verify`** | **`pnpm check` + build + size budget — the full gate: build/config changes, end of a batch, before any push** |

## Architecture map

Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version:

- `src/tools/**` — the registry. Each tool is a **data file**, not code: formats
  in, format out, a zod options schema, and a pipeline of ops. Routes, option
  forms, SEO pages and engine preloads are all derived from it.
- `src/lib/registry/` — `ToolDefinition` contract, format table (ext + mime +
  magic bytes), categories.
- `src/lib/engines/**` — engine adapters (canvas, jsquash, mediabunny, ffmpeg,
  pdf…). Imported **only** by dynamic `import()` inside a worker.
- `src/lib/jobs/`, `src/lib/workers/`, `src/lib/router/` — job queue, worker
  pool, and the router that picks an engine from runtime capability probes.
- `src/lib/sinks/` — where output goes: Blob, streaming ZIP, File System
  Access, OPFS.
- `infra/` — Cloudflare Worker + `wrangler.jsonc`. Serves `out/` plus oversized
  engines from R2 on the same origin.

### Invariants — do not break these

1. **No network I/O with user file data, ever.** `public/_headers` sets
   `connect-src 'self'`, so the page physically cannot upload. Never widen it.
2. **No decode/encode/zip on the main thread.** Main thread does DOM and object
   URLs only. Everything else is in a worker.
3. **No engine in the core bundle.** Engines are dynamic-imported and lazily
   fetched. `pnpm verify` fails the build if an engine lands in a core chunk.
4. **Static export only.** No API routes, no server components with runtime
   data, no Node built-ins in app code. `next build` must succeed with
   `output: "export"`.
5. Core first-load JS budget: **300 KB gzipped**, enforced in CI.

## Adding things

- **New conversion** → use the `add-converter` skill. Long form:
  [docs/ADDING_A_TOOL.md](docs/ADDING_A_TOOL.md).
- **New wasm engine** → use the `add-engine` skill (license check comes first).
- **Ending a work session** → use the `preflight` skill.
- **Cutting a release** → use the `release` skill.
- **Delegating a scoped slice** → the `implementer` subagent
  ([.claude/agents/implementer.md](.claude/agents/implementer.md)). Give it a
  brief naming files, contracts and acceptance criteria.

## Definition of Done

Match the gate to what changed — heavy checks only where they buy signal:

- **Docs, comments, or formatting only** → `pnpm lint` (Biome) is enough.
- **Normal code change** → `pnpm check` (typecheck + lint + test) before commit.
- **Build/config changes** — `next.config.ts`, `public/_headers`, a script in
  the build pipeline, or routes — **or the end of a batch of commits, or
  before any push** → `pnpm verify` (adds build + size budget).

CI runs everything on every push regardless. Never `--no-verify`. Never skip
or `.skip` a test to make it pass. Never widen a budget or a CSP directive to
get a build through — fix the cause.

## Commit rules

- **Conventional Commits.** `feat(tool): add heic to jpg`,
  `fix(engine): free ffmpeg heap on cancel`, `chore:`, `docs:`, `refactor:`,
  `test:`, `ci:`, `perf:`. Releases and the changelog are generated from these,
  so the type and scope matter.
- **Small, incremental commits** — one logical unit each. A new converter is
  typically one commit for the registry entry + tests, and a separate `docs:`
  commit if documentation changed beyond a matrix row. This repo is meant to
  read as a good reference for contributors; the history is part of that.
- **Never add `Co-Authored-By`, "Generated with", or any AI attribution line**
  to a commit message or PR body. Not in the trailer, not in the body.
- Commit directly to `main`. Branch only for risky multi-session refactors
  (engine swaps, framework majors), and merge back promptly.
- Never rewrite pushed history. Never force-push. Tags and version bumps come
  from release-please only — never hand-edit a version or create a tag.

## Docs you maintain as you work

These files are the project's memory. A fresh clone on a new machine must be
enough to continue — keep them true:

- [docs/ROADMAP.md](docs/ROADMAP.md) — check items off **with the date** as you
  complete them. Read this first in a new session.
- [docs/adr/](docs/adr/) — one short ADR per architectural decision. Use
  `docs/adr/template.md`.
- [docs/CONVERTERS.md](docs/CONVERTERS.md) — support matrix; add a row per tool.
- [docs/ENGINES.md](docs/ENGINES.md) and
  [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) — per-engine
  license, size, threading needs. Update when adding or upgrading an engine.

## Onboarding a fresh session

1. [docs/ROADMAP.md](docs/ROADMAP.md) — what is done, what is next.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit.
3. `docs/adr/` — why things are the way they are.
4. Private owner notes, if any, live in `CLAUDE.local.md` (untracked, loaded
   automatically by Claude Code).

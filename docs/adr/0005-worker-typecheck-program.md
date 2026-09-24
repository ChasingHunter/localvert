# ADR-0005: A second `tsc` program for worker-side code

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The root `tsconfig.json` sets `lib: ["DOM", "DOM.Iterable", "ES2023"]` so app
code can use `window`, `document`, and the rest of the browser API surface.
Engine adapters and worker entry points (`src/lib/engines/**`,
`src/**/*.worker.ts`) run in a Web Worker instead, where `document` and
`window` do not exist but `self`, `importScripts`, and worker-only globals
(`OffscreenCanvas` as a constructor rather than an optional feature, etc.) do.

TypeScript's `lib` option is one flat union per program — `DOM` and
`WebWorker` declare conflicting global shapes (`self`, timer return types, and
others), so a single program cannot type both correctly at once. Left as one
program, worker code type-checks against `DOM` and silently accepts
`document.querySelector(...)` inside an engine adapter — exactly the mistake
invariant 2 (no DOM on a worker thread) exists to prevent, and the compiler
would say nothing about it.

## Decision

Add a second, narrower TypeScript program, `tsconfig.worker.json`:

- Extends the root config, but overrides `lib` to `["WebWorker", "ES2023"]`
  and `types: []` — the empty `types` array matters as much as the `lib`
  swap, since `@types/node` and other ambient `.d.ts` files pulled in via
  `node_modules/@types` can leak DOM-shaped globals back in regardless of
  `lib`.
- `include`s only `src/lib/engines/**/*.ts` and `src/lib/workers/**/*.worker.ts`,
  and excludes `*.test.ts` (tests run in a Node/Vitest environment, not a
  worker) and `src/lib/engines/manifest.ts` (generated main-thread data
  consumed by the app, not worker code).
- The root `tsconfig.json` excludes engine adapter subdirectories
  (`src/lib/engines/*/**`) and `src/**/*.worker.ts`, so those files are only
  checked once, under the worker program, and never silently pass against the
  DOM lib.
- `package.json`'s `typecheck` script runs both:
  `tsc --noEmit && tsc -p tsconfig.worker.json --noEmit`.

Top-level files directly in `src/lib/engines/` (`types.ts`, `errors.ts`,
`define-engine.ts`, `index.ts`) stay **in both** programs — they are imported
from both the main thread (the barrel, the manifest) and from inside workers
(adapters), so they must stay environment-neutral: no DOM-only or
worker-only globals, just types and pure functions.

Confirmed by experiment: a throwaway file under `src/lib/engines/` that
referenced `document` failed `tsc -p tsconfig.worker.json --noEmit` with
`TS2584: Cannot find name 'document'`, while `tsc --noEmit` (the root
program) passed it. The file was deleted after confirming this.

## Consequences

**What it buys**

- `document`/`window` inside an engine adapter or a `.worker.ts` file is now
  a compile error, not a runtime surprise discovered in a worker console.
- The two programs are independent — `tsc -p tsconfig.worker.json` doesn't
  need to walk the whole app, so the extra pass is cheap, especially under
  `tsc` 7 (the native, Go-based compiler).

**What it costs**

- Two typecheck passes to reason about instead of one; a contributor adding
  a new worker-side directory has to remember to widen both configs'
  `include`/`exclude` rather than just dropping a file in.
- The shared top-level modules (`types.ts`, `errors.ts`, `define-engine.ts`)
  carry a standing constraint — they must stay usable from both `lib` sets —
  which is easy to violate by accident (e.g. adding a `DOMException`-typed
  parameter is fine, since `DOMException` is available in both `DOM` and
  `WebWorker` libs, but a `Window`-typed one would not be).
- Next.js rewrites `tsconfig.json` on `next build` (it injects
  `.next/types/**/*.ts` into `include` and appends its plugin), so the
  custom `exclude` entries added here were verified to survive a real
  `pnpm build`, not just `tsc --noEmit`, before relying on them.

## Alternatives considered

**Triple-slash `/// <reference lib="webworker" />` at the top of each worker
file.** Rejected: reference directives add to the *program's* global lib set,
they don't replace it per-file — in a single `tsc` invocation this still
merges `WebWorker` and `DOM` project-wide and reintroduces the exact
conflict, or (depending on ordering) just adds noise without isolating
worker files from `document`.

**Keep one `DOM`-only program and rely on code review / lint to catch
worker code touching `window`/`document`.** Rejected: gives up compiler
enforcement for a manual convention, which is exactly the gap invariant 2
exists to close mechanically rather than socially.

**One program with a `lib` union of both (`["DOM", "WebWorker", "ES2023"]`).**
Not viable — `DOM` and `WebWorker` declare incompatible shapes for the same
global names (notably `self` and the timer/`postMessage` signatures), so
TypeScript errors on the union itself rather than picking one.

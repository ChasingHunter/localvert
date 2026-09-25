---
name: add-engine
description: Integrate a new WebAssembly conversion engine into Localvert (license review, adapter, worker wiring, asset placement, size budget). Use when a conversion needs a codec or library the project does not have yet.
---

# Add an engine

Engines are the risky, rare change: they carry licensing consequences, tens of
megabytes of assets, and the privacy guarantee. Work through this in order.

## 1. License review — before installing anything

Find the engine's license and its transitive native components (an "MIT" npm
wrapper around a GPL binary is a GPL dependency).

- **Permissive (MIT/BSD/Apache-2.0)** — fine, proceed.
- **LGPL / MPL** — fine as an unmodified, separately-fetched artifact. Record it.
- **GPL / AGPL** — proceed only if it can be a *lazily fetched, unmodified,
  arm's-length* artifact, and only if there is no viable permissive
  alternative. Read `docs/adr/0002-mit-license-gpl-isolation.md` first and
  follow the isolation rules there exactly.
- **Non-OSI / unclear / source-available** — **stop and ask the user.**

Record the finding in `docs/THIRD_PARTY_LICENSES.md` and `docs/ENGINES.md`
before writing code. If this decision was non-obvious, add an ADR.

## 2. Install and inspect

Install the package, then check what actually ships: the size of the `.wasm`,
whether it needs threads (`SharedArrayBuffer`), and whether it fetches anything
at runtime. **Any engine that fetches from a CDN by default must be
reconfigured to load from our own origin** — `connect-src 'self'` will block it
otherwise, and that block is the privacy guarantee working as intended.
Review the pnpm lockfile diff before committing.

## 3. Adapter

Create `src/lib/engines/<name>/adapter.ts` implementing `EngineAdapter` from
`src/lib/engines/types.ts`. Rules:

- Reached **only** by dynamic `import()` from the worker entry. A static import
  anywhere in the main-thread graph pulls the engine into the core bundle and
  fails the size budget.
- `load()` initialises wasm once; `dispose()` must actually free it.
- Report progress through the task's `onProgress`; the throttle lives in the
  worker, so call it freely.
- Honour `task.signal`. Wasm cannot be interrupted mid-call, so long operations
  should check the signal between stages; the pool terminates the worker for
  hard cancellation.

## 4. Asset placement

Set `location` to `"static"` or `"r2"` in the engine's `engine.json`, and add
the two fields that go with it: `package` (the npm package the assets come
from) and `files` (each one's `{from, to}` — `from` relative to that
package's directory, `to` the filename it ships as). `version` must equal the
installed package's version. Both fields are forbidden for `"native"`.

Then run `pnpm sync-engines` — no per-engine code to write, it reads
`engine.json` and does the rest:

- **≤ 20 MiB** → copied to `public/engines/<id>@<version>/`, served as a static
  asset. Version in the path means the URL is immutable and cacheable forever.
- **> 20 MiB** → copied to `.engines-r2/xl/<id>@<version>/` (staged for
  `pnpm upload-r2`) and served through the Worker route. Cloudflare's
  static-asset limit is 25 MiB per file; we keep 20 as headroom. A "static"
  file over the limit fails the command outright; an "r2" engine whose files
  are all comfortably under it gets a warning to reconsider "static".

`sync-engines` also rewrites `engine.json`'s `assets` field to the real
`{path, bytes}` list and runs `pnpm gen` — commit the result. `pnpm build`
runs `sync-engines` automatically; a fresh "r2" engine still needs
`pnpm upload-r2` (CI's deploy job does this) before its assets exist in the
bucket.

Both paths stay same-origin, so CSP and COEP are unaffected. Never load an
engine from a third-party CDN.

## 5. Wire, test, document

- Register the engine id in the worker's dynamic-import switch (`pnpm gen`
  regenerates it) and add the capability entries the router needs.
- Smoke test in browser mode: one real fixture through one operation, asserting
  output magic bytes and a size range.
- If the engine needs threads, confirm the router's `crossOriginIsolated` probe
  gates it and that a single-threaded fallback exists or the tool is correctly
  marked unavailable.
- `docs/ENGINES.md`: capabilities, wasm size, threading, licence, quirks.
- Show the download size in the UI before fetching anything large — users on
  metered connections must consent to a 30 MB download.

## 6. Ship

`pnpm verify`, then `feat(engine): add <name>`. Keep the engine commit separate
from the commits adding tools that use it.

## Emscripten / wasm-bindgen glue — do not bundle self-referencing loaders
If the engine's JS glue contains `new Worker(new URL(<its own file>, import.meta.url))`
(Emscripten pthreads builds do — libraw-wasm did, ffmpeg core-mt will), **never import it
statically**: Turbopack follows the self-reference and `next build` hangs forever. Ship the glue
as a static asset in `engine.json` `files` and load it at runtime:
`await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ `${ctx.baseUrl}glue.js`)`.
Grep the glue for `import.meta.url` / `new Worker` before choosing. See the libraw adapter.

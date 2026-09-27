# ADR-0011: Markdown to PDF on typst.ts, vendored fonts and package

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Phase 4b adds `markdown-to-pdf`, the first Document-category converter. The
brief named `typst.ts` — Typst's own wasm compiler, compiled to PDF — over a
JS-side PDF-builder library (e.g. `pdfmake`) because Typst already has a
correct, well-tested layout engine (page flow, headings, lists, tables, code
blocks) and a maintained markdown-to-Typst bridge (`cmarker`), where a
`pdfmake` route would mean hand-rolling both. The cost is size: the raw
compiler wasm is 28.3 MB, and its Rust-side default package resolution wants
to fetch Typst packages from `packages.typst.org` — flatly incompatible with
this project's first invariant (no network I/O with user file data, and no
network at all beyond same-origin static assets).

Three sub-decisions fell out of getting this engine working within those
constraints:

1. **Which of the two typst.ts npm packages to import at runtime, and how.**
   `@myriaddreamin/typst.ts` (the documented, higher-level wrapper) is pure JS
   with no wasm of its own, but its own `compiler.mjs` contains a bare
   `import('@myriaddreamin/typst-ts-web-compiler')` — a static import site a
   bundler resolves at build time regardless of which runtime branch actually
   executes it (its `getWrapper` option only skips *calling* that import, not
   the bundler tracing into it). That is the same "self-referencing asset"
   shape `libraw`/`ffmpeg`'s adapters already work around, except for a 28 MB
   wasm file instead of a self-referencing Worker.
2. **How to serve the wasm at all**, given it exceeds both the 20 MiB
   static-asset threshold this repo uses (ADR-0003) and, combined with the
   vendored fonts/cmarker below, the 25 MiB Cloudflare hard limit.
3. **Where cmarker and the fonts come from**, since none of them are
   published to npm.

## Decision

**Reimplement the small slice of `@myriaddreamin/typst.ts`'s wrapper logic
this tool needs directly against the raw `@myriaddreamin/typst-ts-web-
compiler` bindings** (`TypstCompilerBuilder`/`TypstCompiler`/
`TypstCompileWorld`, typed by hand off that package's own
`typst_ts_web_compiler.d.ts`), and never import the wrapper package at
runtime at all. `src/lib/engines/typst/adapter.ts`'s every call
(`set_access_model`, `add_raw_font`, `snapshot`, `get_artifact`) was written
by reading `@myriaddreamin/typst.ts`'s own `compiler.mjs`/`options.init.mjs`
source to confirm the exact wiring, then copied directly — same behavior,
without the bundler-unsafe import. The raw compiler's own glue
(`typst_ts_web_compiler.mjs`) and wasm are `sync-engines`-copied static
assets, loaded via a runtime `import()` with `webpackIgnore`/
`turbopackIgnore`/`@vite-ignore`, same pattern as `libraw`/`ffmpeg`.

**Ship the engine via `location: "static"`, with the compiler wasm gzipped**
(`typst_ts_web_compiler_bg.wasm.gz`, ~10.3 MiB vs. ~28.3 MiB raw — under the
20 MiB static-asset ceiling), decompressed at runtime via
`DecompressionStream("gzip")` (the adapter checks the first two bytes for the
gzip magic `1F 8B` and falls back to using the bytes as-is if something
upstream ever decodes them first — nothing in `public/_headers`/infra
declares `Content-Encoding` for `/engines/*`, so this is the only decode step
that exists).

This supersedes this ADR's original decision (`location: "r2"` +
`consent: true`, the path `ffmpeg`/ADR-0002 established) — not because r2 was
wrong in itself, but because bringing the engine up under this app's real CSP
(next section) surfaced that `sync-engines.ts` could gzip one file cheaply
(a `gzip: true` flag on a `files[]` entry, ~15 lines in `copyOneFile`, sized
correctly in `gen-registry.ts`'s `resolveAssets` too), which drops the whole
engine under the static-asset ceiling and removes the download-consent
prompt entirely — a strictly better outcome for a user converting a markdown
file, at the cost of one small, general (not typst-specific) `sync-engines`
feature instead of zero.

**The wasm-bindgen glue must be patched to remove two `new Function(string)`
calls, or the engine cannot run under this app's CSP at all.**
`@myriaddreamin/typst-ts-web-compiler`'s glue (`typst_ts_web_compiler.mjs`)
imports two host functions the wasm module calls, unconditionally, while
constructing a fresh `TypstCompilerBuilder` — before this adapter ever calls
`set_access_model`/`add_raw_font` — to build its own *default* ("dummy")
AccessModel/Registry implementations, via `new Function(body)`/
`new Function(args, body)`. `script-src` with no `unsafe-eval` (this repo
never adds that directive — see CLAUDE.md's invariants) blocks that outright:
"Evaluating a string as JavaScript violates ... 'unsafe-eval'". Grepping the
real `_bg.wasm`'s string literals confirms the *only* bodies the wasm module
ever passes to these two imports are five fixed dummy-method strings — never
markdown, never anything derived from the file being compiled — so
`scripts/sync-engines.ts`'s `patchTypstGlue` (applied at sync time via a
`patch: "typst-glue"` flag on the `.mjs` file entry, the same generic-flag
shape as `gzip`) rewrites those two import functions into a closed lookup
over exactly those five `(args, body)` pairs, mapped to pre-written static
functions, and fails closed (throws) on anything else. It also asserts the
regex it matches on found **exactly one** instance of each import before
trusting the patch, and that the patched output contains zero remaining
`new Function(` — so a typst-ts upgrade that reshapes this glue fails
`pnpm sync-engines` loudly instead of shipping an unpatched (CSP-broken) or
silently-wrong (regex-missed) copy.

Fixing the CSP failure surfaced a second, independent bug this ADR also
fixes: `runTranscode`'s original `finally { builder.free(); }` double-frees
the builder. `TypstCompilerBuilder.build()`'s own generated JS calls
`this.__destroy_into_raw()` (zeroing the wrapper's pointer) before handing
ownership to the compiler it returns — the same operation `free()` performs
— and this package's generated `free()` doesn't guard against an
already-zeroed pointer, so calling it again panics ("null pointer passed to
rust") instead of being a no-op. The fix is a `builderConsumed` flag set
immediately before calling `build()`, so the outer `finally` only calls
`builder.free()` if `build()` was never reached (e.g. `set_access_model`/
`add_raw_font` threw first).

**Vendor `cmarker` 0.1.8 and the Libertinus Serif / DejaVu Sans Mono fonts
under `vendor/`** rather than fetching them from `packages.typst.org` /
`typst-assets` at runtime. Each was downloaded once, at dev time, and
committed verbatim alongside its own license file — the same "unmodified
upstream build" rule every npm-sourced engine here already follows, just
without npm as the delivery mechanism. `sync-engines.ts`/`gen-registry.ts`
gained a `package: "local"` sentinel on an `engine.json` file entry: instead
of resolving an npm package directory, it resolves the file straight from
this repo's own root (`vendor/...`) — a small, generically useful extension
(not typst-specific), documented on `EngineSourceFile` in
`src/lib/engines/types.ts`.

**Import `cmarker` by its vendored in-memory file path
(`/packages/preview/cmarker/0.1.8/lib.typ`), never by the
`@preview/cmarker:0.1.8` package-spec syntax.** Reading cmarker's own
vendored `lib.typ` confirms it only ever resolves its own plugin via a
*relative* import (`plugin("./plugin.wasm")`) — it never itself imports
another `@preview` package — so a plain file-path import in our generated
`main.typ` satisfies it completely. That means this engine's whole
"filesystem" is a small in-memory `Map` (`main.typ` + the job's own
`input.md` + cmarker's two files), populated through Typst's lower-level
`set_access_model` hook, and **`withPackageRegistry`/`FetchPackageRegistry`
are never configured or reached** — there is no `@preview/...` import in our
own source for a registry to ever have to resolve, so nothing ever asks
"what does this package spec resolve to," and `packages.typst.org` is never
contacted. (This is a narrower, but stricter, way of satisfying the brief's
"never use `withPackageRegistry`/`FetchPackageRegistry`" instruction than a
locally-resolving-only registry class would have been.)

**Markdown images render as their alt text only.** `cmarker`'s default `img`
handler calls Typst's `image()` on the markdown's `src` path, which our
in-memory access model can't serve — out of scope per the brief. The
generated template overrides `cmarker`'s `html: (img: ...)` option with a
handler that renders only the image's alt text, so a markdown image can
never abort the compile with a file-not-found error.

## Consequences

- Now that the engine is `location: "static"`, it gets real integration
  coverage from both `src/lib/engines/typst/adapter.browser.test.ts` (a real
  worker, real wasm, real gzip decompression, real patched glue — see that
  file's doc comment for why it goes through `createWorkerPool`/
  `spawnEngineWorker` rather than calling the adapter directly) and
  `e2e/markdown.spec.ts` (the real built `out/`, real CSP headers from
  `public/_headers` — the only place the `patchTypstGlue`/`unsafe-eval`
  fix is actually proven, since vitest's browser-mode dev server sets no
  CSP header at all). `template.test.ts` and `no-bundled-glue.test.ts` still
  cover template generation, option mapping and the bundling guard at the
  unit level; `scripts/typst-glue-patch.test.ts` covers the glue patch
  itself, including against the real installed package.
- A future typst.ts upgrade that changes `compiler.mjs`'s internal wiring
  (the exact `set_access_model`/`snapshot`/`get_artifact` call shapes this
  adapter copied) needs re-verifying against the new version's source — this
  adapter does not track the wrapper package's own compatibility guarantees,
  because it deliberately doesn't depend on the wrapper at runtime.
- `cmarker`, Libertinus Serif and DejaVu Sans Mono are pinned by committed
  file, not by any registry version resolution — an upgrade means re-running
  the same one-time vendoring step by hand and committing the new files,
  unlike every npm-sourced engine's Dependabot-driven version bump.
- Tables/lists/headings/code blocks/links render through Typst's own layout;
  no attempt was made to support embedded images, footnotes beyond what
  `cmarker` handles by default, or custom Typst markup inside the markdown.

## Alternatives considered

- **A JS PDF-builder (e.g. `pdfmake`) instead of typst.ts** — smaller and
  simpler to bundle, but reimplements page layout, text flow and table
  rendering by hand instead of reusing Typst's; rejected per the brief's
  choice of typst.ts.
- **`withPackageRegistry` with a hand-written, network-free `PackageRegistry`**
  that resolves `@preview/cmarker:0.1.8` to the vendored files' in-memory
  directory — considered and rejected once reading `cmarker`'s own source
  showed its plugin import is relative, making a package-spec import (and
  therefore any registry at all) unnecessary. Simpler, and it also reads as a
  more literal compliance with the brief's "never use
  `withPackageRegistry`/`FetchPackageRegistry`" instruction.
- **`r2` + `consent: true`** (this ADR's original decision) — reused
  `ffmpeg`'s proven upload/seed/consent plumbing instead of adding gzip
  support to `sync-engines.ts`. Superseded once the CSP fix (above) was
  already touching `sync-engines.ts`'s per-file transform machinery anyway,
  at which point gzipping one file became a small addition rather than a new
  path, and the consent-free result was strictly better for the user.

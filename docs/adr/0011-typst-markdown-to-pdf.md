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

**Ship the engine via `location: "r2"` + `consent: true`**, the same path
`ffmpeg` (ADR-0002) already established for an engine too large for the
static-asset budget: no build-time gzip transform of `sync-engines.ts` was
needed (the brief's first-choice idea), since r2 placement carries no 20 MiB
ceiling and reuses proven, already-tested plumbing (`upload-r2.ts`,
`seed-r2-local.ts`, the consent dialog) rather than adding a new
compress/decompress path to a script whose own module doc comment says it
must stay simple and self-contained. Total delivered size is ~30.6 MiB
(28.3 MiB compiler wasm + ~1.9 MiB fonts + ~0.3 MiB cmarker).

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

- The engine only ever gets real integration coverage through
  `e2e/markdown.spec.ts` (a live `wrangler dev` run, R2-backed), not a vitest
  browser test — mirroring `ffmpeg`, the only other `r2`-located engine in
  this repo, which likewise has no `adapter.browser.test.ts`: there is no
  local R2 route inside vitest's Vite dev server, only inside `wrangler dev`
  (seeded by `scripts/seed-r2-local.ts`). `src/lib/engines/typst/
  template.test.ts` and `no-bundled-glue.test.ts` cover template generation,
  option mapping and the bundling guard at the unit level instead.
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
- **Gzip-compressed static delivery** (`typst_ts_web_compiler_bg.wasm.gz`
  under the 20 MiB static-asset ceiling, decompressed at runtime via
  `DecompressionStream`) — the brief's suggested first try. Not implemented:
  `r2` placement has no size ceiling at all and reuses the already-built,
  already-tested consent/upload/seed pipeline `ffmpeg` proved out, at the
  cost of one more consent prompt for a user who wants this specific
  conversion — a smaller cost than adding a new compression transform to
  `sync-engines.ts`.

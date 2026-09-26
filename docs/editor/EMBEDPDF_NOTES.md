# EmbedPDF v2 spike notes (ADR-0009, slice E0)

**Status: NO-GO within this timebox — one unresolved runtime blocker.**
Everything about EmbedPDF v2's *design* checks out (self-hosted wasm, PDFium
running only in a worker by construction, true content-level redaction, a
clean build). But the one live, in-browser, real-worker run that was
attempted hung indefinitely with no error surfaced, and the 60-minute
timebox ran out before the cause could be found. All partial code wiring
was reverted; this file is the only thing this slice commits. See "The
blocker" below for exactly where it stopped, and "What's proven vs not" for
a precise per-criterion breakdown — the picture is much closer to GO than a
flat NO-GO reads, and E1 (or a short follow-up spike) should very likely
pick this back up rather than jump straight to the pdf.js fallback.

## Packages evaluated (MIT only, pinned to 2.15.1)

`pnpm view <pkg>@2.15.1 license` confirmed MIT for all of the following.
All were installed, exercised, and then removed (`pnpm remove`) at the end
of this spike per the NO-GO path:

- `@embedpdf/core`, `@embedpdf/models`, `@embedpdf/engines`, `@embedpdf/pdfium`
- `@embedpdf/plugin-annotation`, `@embedpdf/plugin-redaction`,
  `@embedpdf/plugin-render`, `@embedpdf/plugin-export`,
  `@embedpdf/plugin-viewport`, `@embedpdf/plugin-document-manager`,
  `@embedpdf/plugin-interaction-manager`, `@embedpdf/plugin-scroll`,
  `@embedpdf/plugin-selection`, `@embedpdf/react-pdf-viewer`

Explicitly NOT installed:
- `@embedpdf/plugin-form` — ships with no license field (per ADR-0009), so it
  is unusable regardless of what it does. Forms stay out of scope; do them
  with pdf-lib/PDFium's own form API instead, as the ADR already says.
- Everything under `3.0.0-next.*` (core-stage, plugin-stage, viewer,
  engine-runtime-*, react, viewer-react, viewer-chrome) — v3 is unstable per
  the ADR; only 2.15.1 packages were considered.
- `@embedpdf/plugin-loader` — versioned independently (1.5.0, not 2.15.x);
  not evaluated, not needed for this spike.

## The single most important finding

**`@embedpdf/engines`'s `createPdfiumEngine` gives a complete,
promise-first `PdfEngine` API on its own** — open, render, annotate,
redact, export, text extraction — with zero UI framework required. The
`@embedpdf/core` + `plugin-*` packages are for wiring interactive UI
(toolbars, pointer-driven annotation placement, a React tree) on top of
that same engine; this spike never imported them. **For E1's decision**:
the engine alone is enough to build a first cut of redaction/annotation/
export; the plugin/React layer is an additive, separable choice, not a
prerequisite.

## API notes

### Engine factory / worker wiring

```ts
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
// or the barrel: import { createPdfiumWorkerEngine } from "@embedpdf/engines/pdfium";
//   (that barrel ALSO re-exports createPdfiumDirectEngine, i.e. main-thread
//   PDFium -- import the specific `/pdfium-worker-engine` subpath instead,
//   never the barrel, so a main-thread PDFium path can never even be reachable)

const engine = createPdfiumEngine(wasmUrl, {
  fontFallback: null, // disables the embedded-font-fallback CDN entirely
  encoderPoolSize: 0, // >0 spins up an additional image-encoder worker pool
});
```

`createPdfiumEngine` (package `@embedpdf/engines`, subpath export
`./pdfium-worker-engine`, source `dist/lib/pdfium/web/worker-engine.js`)
**creates its own Web Worker internally** — you never write a worker file
yourself. Confirmed by reading the built source: the worker's *entire*
program (the Emscripten/PDFium glue included) ships as one big JS string
literal, instantiated via
`new Worker(URL.createObjectURL(new Blob([<program string>], { type:
"text/javascript" })), { type: "module" })`.

- **No self-referencing `import.meta.url`/`new Worker(new URL(...))` for
  Turbopack to trip over** (the add-engine skill's documented hang cause).
  The worker's source is a plain string constant inside `worker-engine.js`
  — nothing in the app's module graph statically imports `@embedpdf/pdfium`
  itself (confirmed by grepping the built `worker-engine.js`: its only
  imports are internal `@embedpdf/engines` chunks and `@embedpdf/models`).
  `@embedpdf/pdfium`'s own `index.browser.js` (the one file that *does*
  contain a bundler-sensitive `new URL('pdfium.wasm', import.meta.url)`
  default-location fallback) is never reached by static analysis in this
  setup — it isn't imported anywhere in the app's graph, only embedded as
  an opaque string inside `@embedpdf/engines`' own prebuilt worker payload.
  **Directly confirmed**: `rm -rf .next out && pnpm build` completed in
  under 90 seconds, no hang, with the spike page wired in and both
  `@embedpdf/engines` and `@embedpdf/models` as real dependencies.
- Main-thread code that calls `createPdfiumEngine(...)` never touches
  PDFium itself — every `PdfEngine` method (`openDocumentBuffer`,
  `renderPage`, `createPageAnnotation`, `redactTextInRects`, `saveAsCopy`,
  …) is a message-passing proxy (`postMessage`/`onmessage`) to that worker.
  Invariant 2 holds **by construction** in the source — but see "The
  blocker" below: the live run never got far enough to see this worker
  actually produce a result.

### Wasm URL / self-hosting option

`createPdfiumEngine(wasmUrl, options)`'s first argument is a plain URL
string, posted to the worker as `{ type: "wasmInit", wasmUrl }`; the worker
itself does `fetch(wasmUrl)` (same-origin, subject to `connect-src 'self'
blob:'`). Point it at a synced static asset:

```ts
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
const wasmUrl = `${ENGINE_MANIFEST.pdfium.baseUrl}pdfium.wasm`; // "/engines/pdfium@2.15.1/pdfium.wasm"
```

`engine.json` for this followed the exact same static-asset contract as
`pdfjs`/`libraw`: `package: "@embedpdf/pdfium"`, one file
`dist/pdfium.wasm` -> `pdfium.wasm`, no hand-written `version`/`assets`.
`pnpm sync-engines` copied it to `public/engines/pdfium@2.15.1/pdfium.wasm`
(**4,646,932 bytes**, matching ADR-0009's ~4.5 MB estimate) with zero
extra steps — this part of the tooling needed no changes at all.

`@embedpdf/pdfium`'s lower-level `init()` (used in the Node correctness
script below, bypassing `createPdfiumEngine`'s own worker) takes a
`Partial<PdfiumModule>` — a standard Emscripten `Module` object — so
`init({ wasmBinary })` (an `ArrayBuffer` fetched or read yourself) skips
the package's own `new URL('pdfium.wasm', import.meta.url)` default
entirely. Confirmed working end to end from a local file, zero network.

Font fallback: `CreatePdfiumEngineOptions.fontFallback: null` fully
disables PDFium's fallback-font CDN requests (for PDFs referencing fonts
not embedded in the document). This MUST stay set (or be pointed at a
same-origin font pack) for invariant 1 — the unset default is not zero-CDN
(see `dist/lib/pdfium/cdn-fonts.d.ts`), exactly the "any engine that
fetches from a CDN by default must be reconfigured" case the add-engine
skill calls out.

### Redaction API — proven at the engine level (bypassing the worker)

Two-step, both on the plain `PdfEngine`, no plugin needed:

```ts
await engine.redactTextInRects(doc, page, [rect], { drawBlackBoxes: true }).toPromise();
await engine.applyAllRedactions(doc, page).toPromise();
// or, for one specific annotation: engine.applyRedaction(doc, page, annotation)
```

Verified with a Node script using `@embedpdf/pdfium`'s `init()` +
`PdfiumNative` + `PdfEngine` **directly** — i.e. the same low-level classes
`createPdfiumEngine`'s worker uses internally, but run directly in Node,
*not* through `createPdfiumEngine`'s own worker-spawning path — against a
fixture built with `@cantoo/pdf-lib` containing the text "SECRET-4711":

- `engine.getPageTextRects(doc, page)` located the exact rect containing
  "SECRET-4711".
- After `redactTextInRects` + `applyAllRedactions` + `saveAsCopy`, the
  exported PDF's **text content is gone**: `pdfjs-dist`'s
  `getTextContent()` on the exported bytes returned only `"public
  information"` — "SECRET-4711" does not appear.
- The **raw exported bytes** (searched as a latin1 string, i.e. the actual
  content stream, not just the text layer) also do not contain
  "SECRET-4711" anywhere — true content removal, not a black box drawn
  over still-extractable text.
- The exported PDF, parsed with `@cantoo/pdf-lib`, has exactly one page
  `/Annot` with `/Subtype /Highlight` — the highlight annotation created in
  the same run round-trips through export correctly.

`applyAllRedactions` returned `false` in this run (`redactTextInRects`
appears to remove the content directly, rather than only staging a
`REDACT` markup annotation for `applyAllRedactions`/`applyRedaction` to
commit later) — the boolean likely means "no *pending* redaction markup
annotations found", not failure; the text was already gone by that point.
**Open question for whoever picks this up next**: confirm from EmbedPDF's
own source whether `redactTextInRects` unconditionally removes content
immediately, or does so because `drawBlackBoxes: true` also triggers
immediate removal as a side effect — matters if a redaction UI wants a
"mark several regions, review, then apply once" flow.

**Caveat that matters**: this redaction proof used the *direct*, non-worker
code path (`PdfiumNative`/`PdfEngine` with `init({ wasmBinary })`), not
`createPdfiumEngine`'s worker-spawning path that the live browser run got
stuck in (see below). The underlying PDFium redaction behaviour is proven;
that it behaves identically when driven through the worker message-passing
layer is not yet directly confirmed.

### Export API

`engine.saveAsCopy(doc).toPromise()` -> `ArrayBuffer` of the full PDF,
ready to save/download. No separate "export plugin" needed.

### Annotation API

`engine.createPageAnnotation(doc, page, annotationObject, context?)` where
`annotationObject` is a discriminated union on `type:
PdfAnnotationSubtype` (from `@embedpdf/models`) — e.g.
`PdfAnnotationSubtype.HIGHLIGHT` needs `id`, `pageIndex`, `rect`,
`segmentRects`, `opacity`, `strokeColor`/`contents`. Every other annotation
type (`INK`, `FREETEXT`, `STAMP`, `SQUARE`, …) is its own interface in
`@embedpdf/models`'s `pdf.d.ts` — an already-typed menu for a future
annotation toolbar.

### Plugin / React bindings

Not evaluated beyond confirming their npm packages exist, are MIT, and
install cleanly at 2.15.1 — this spike never imported `@embedpdf/core` or
any `plugin-*` package (see "The single most important finding" above).

## The blocker

A throwaway spike page (`src/app/labs/pdf-editor/page.tsx`, since reverted)
ran the same open/render/annotate/redact/export flow as the Node script,
but through the real `createPdfiumEngine(wasmUrl, ...)` worker path, built
with `pnpm build` and served through the real Cloudflare Worker
(`pnpm exec wrangler dev --config infra/wrangler.jsonc --port 8795
--local`), driven by a throwaway Playwright script.

**Sequence observed, every run, deterministic:**
1. Fixture built client-side (pdf-lib). Logged.
2. `createPdfiumEngine(wasmUrl, { fontFallback: null })` called. Logged.
3. Two `blob:` Workers are created (visible via Playwright's
   `page.on("worker")` and confirmed via a CDP `Target.attachedToTarget`
   listener) and their script bodies fetch successfully (HTTP 200).
4. **Nothing happens after that.** No request for `pdfium.wasm` is ever
   issued (checked via `page.on("requestfinished")`/`"requestfailed")` —
   the wasm fetch is never even attempted, so this isn't a wasm-loading
   failure, it's something upstream of that inside the worker's own
   startup). No `securitypolicyviolation` event, no `pageerror`, no
   `console` message of any kind from the worker context. The call hangs
   past a 90-second wait with no error surfaced through any of Playwright's
   standard channels.
5. Both workers eventually close (page navigation/teardown), never having
   produced a "ready" response.

**One real bug found and fixed-in-place along the way, independent of the
above**: `public/_headers`' header-layer CSP has an explicit `worker-src
'self' blob:'` (see ADR-0006), but the **per-page meta CSP that
`scripts/csp-inline-hashes.ts` injects only ever sets `script-src`, never
`worker-src`**. Per the CSP spec, an absent `worker-src` on one policy
falls back to that *same* policy's `script-src` — and the meta layer's
`script-src` is hash-strict with no `'blob:'` source. Two CSP policies
intersect, so the meta layer's fallback silently vetoes the blob worker the
header layer explicitly allows, and a real `securitypolicyviolation`
("Creating a worker from 'blob:...' violates ... script-src ...") fired on
the first run. Patching the built HTML's injected meta tag to add
`; worker-src 'self' blob:` (matching, not widening, the header's existing
intent) made the CSP violation disappear on the next run — **confirmed**,
zero `securitypolicyviolation` events and zero cross-origin requests after
that one-line patch. This is a **pre-existing gap in
`scripts/csp-inline-hashes.ts`**, not specific to EmbedPDF — it would block
*any* engine that creates a `blob:` Worker (none currently do; PDFium via
EmbedPDF would be the first). The fix is narrow: have
`injectMetaCsp()` also emit `worker-src 'self' blob:'` in the meta tag it
generates. **This fix was validated by hand-patching the built output, not
committed to `scripts/csp-inline-hashes.ts` itself** — that script has its
own tests and governs every page's CSP, which is beyond a spike's scope to
change unilaterally; it should land as its own small `fix:` commit,
reviewed on its own, before or alongside whichever engine first needs it.

Even with that CSP gap patched, the worker never got further than "created,
script loaded" — the actual blocker above (silently stuck before even
requesting the wasm) is still unexplained. Debugging avenues not yet tried
that seem most promising if this is picked back up:
- Attach the CDP `Runtime` domain to the specific worker `sessionId` via a
  dedicated `context.newCDPSession(worker)` per Worker object (this spike's
  attempt reused a single page-level session with `Target.setAutoAttach`,
  which attached but never surfaced `Runtime.consoleAPICalled`/
  `Runtime.exceptionThrown` from the child sessions — likely a
  session-routing mistake in the throwaway script, not proof the worker is
  silent).
- Open the page in a real, visible Chrome window (not headless Playwright)
  and read the Worker's own DevTools console directly.
- Check whether `{ type: "module" }` blob workers have some interaction
  with this Next.js/Turbopack build's `<meta>`-based `wasm-unsafe-eval`
  placement that a header-only CSP wouldn't have.
- Try the same page with the `pdfium-direct-engine` (main-thread, no
  worker) export instead, purely as a diagnostic (never as the shipped
  path — it would violate invariant 2), to isolate whether the problem is
  "PDFium in general in this build" vs. "specifically the worker spawn
  path".

## What's proven vs not — per criterion

1. **Self-hosted wasm — GO, by source reading and the Node script; NOT
   confirmed in a live, working, worker-driven browser run** (the run that
   would have shown the actual `pdfium.wasm` network request never got far
   enough to make that request at all).
2. **Engine in a Web Worker — GO by construction** (verified from the built
   source: the worker is created, is a real separate global scope, and the
   main thread's `PdfEngine` object is nothing but a postMessage proxy) —
   but **not confirmed to actually work**: the live run's worker never
   completed initialization, so "runs in a worker" is true but "and that
   worker successfully does anything" is unproven live.
3. **CSP clean — one real bug found and its fix validated by hand-patching
   the built output** (see "The blocker" above); the *fix* is not yet
   committed anywhere (out of this spike's scope). With that fix applied,
   zero CSP violations and zero cross-origin requests were observed for
   as much of the flow as executed (steps 1-3 above) before it hung.
4. **True redaction — GO, directly proven**, but only via the direct
   (non-worker) code path — see the caveat in "Redaction API" above.
5. **Build health — GO.** `rm -rf .next out && pnpm build` completed in
   under 90 seconds with the spike page and both `@embedpdf/engines` and
   `@embedpdf/models` wired in as real dependencies. No Turbopack hang.
6. **Bundle/engine sizes — pdfium.wasm is 4,646,932 bytes (4.43 MiB)**,
   matching ADR-0009's estimate. `pnpm check-sizes` passed with the spike
   page in place: its first-load JS was 134.5 KB gz (45% of the 300 KB
   budget), in line with every other non-tool page, confirming the
   `@embedpdf/*` packages did not leak into the core bundle (they were only
   ever dynamically imported from inside a click handler, never at module
   scope).

**Overall: this is a NO-GO for this slice's timebox, but not a NO-GO for
EmbedPDF v2 on the merits.** Every criterion that could be checked by
reading source, running a Node script, or running the real build passed
cleanly. The one thing that didn't work is the live, in-browser,
worker-driven run — and it failed silently in a way this spike's
instrumentation could not diagnose in the time remaining, not in a way
that pointed at a fundamental problem with EmbedPDF, PDFium, or this
codebase's architecture. Recommend a short, focused follow-up (get one
real DevTools console open on the actual worker, or fix the CSP gap for
real and retry with better worker-level instrumentation) before deciding to
fall back to the pdf.js editor layer.

## What was reverted

Per the no-go path: `src/app/labs/pdf-editor/page.tsx`,
`src/lib/engines/pdfium/{engine.json,adapter.ts}`, the synced
`public/engines/pdfium@2.15.1/` asset, and the `ids.ts`/`loaders.ts`
registry entries `pnpm gen` had added for `pdfium` were all removed;
`pnpm sync-engines` was re-run to regenerate the registry files back to
their pre-spike state. All fourteen `@embedpdf/*` packages were removed
with `pnpm remove`. `git status` should show only this file as new.

## What's left, if this is picked back up

- Get a working, low-level view into the stuck worker (see "Debugging
  avenues" above) and find out why it never even requests the wasm file.
- Land the `scripts/csp-inline-hashes.ts` `worker-src` fix as its own small,
  tested `fix:` commit (needed by any future `blob:`-worker engine, not
  just this one).
- Decide: build the editor UI directly on the bare `PdfEngine` API (this
  spike's approach — full control, more code) vs. adopt `@embedpdf/core` +
  `plugin-*` + `@embedpdf/react-pdf-viewer` (less code, pulls in a UI
  framework this codebase doesn't otherwise use).
- Design the "app-mode" registry tool kind ADR-0009 calls for — this spike
  deliberately did not force PDFium into the existing job-pipeline
  `EngineAdapter`/`EngineTask` contract (a stateful session doesn't fit a
  one-shot `run(task)` call); a stateful session needs its own contract.
- Decide the font-fallback story (ship a font pack same-origin, like
  `pdfjs`'s `standard_fonts/`, or accept missing-glyph rendering).
- Confirm the `applyAllRedactions`-returns-`false` semantics against
  EmbedPDF's own source/docs before building a "mark then apply" redaction
  UI on top of it.

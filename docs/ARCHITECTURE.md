# Architecture

Localvert converts files entirely inside the browser. There is no server, no
API route, and no upload path — not as a policy, but as a property of how the
page is built and served.

If you read one thing here, read [Invariants](#invariants). Everything else is
detail in service of those five rules.

---

## The shape of it

```
            main thread                      |            worker(s)
                                             |
  file input / drag-drop                     |
        |                                    |
        v                                    |
  sniff magic bytes --> FormatId             |
        |                                    |
        v                                    |
  registry lookup --> ToolDefinition         |
        |             (slug, pipeline,       |
        |              options schema)       |
        v                                    |
  validate options (zod)                     |
        |                                    |
        v                                    |
  job engine --> queue --> worker pool ------+--> capability probes
        |                                    |          |
        |  (File handle, not bytes)          |          v
        |                                    |    engine router
        v                                    |          |
  zustand store <-- progress (10 Hz) --------+          v
        |                                    |    dynamic import()
        v                                    |    engine adapter
  sink: Blob / ZIP stream /  <---------------+--- run(task)
        File System Access / OPFS            |          |
        |                                    |          v
        v                                    |    bytes | stream | OPFS ref
  object URL --> download                    |    (transferred, not copied)
```

The main thread owns DOM, object URLs, and job bookkeeping. It never decodes,
encodes, or zips. Everything expensive happens behind the line.

---

## The registry: tools are data, not code

`src/tools/**` is the centre of gravity. A conversion is a **data file**:

```ts
// src/tools/image/jpg-to-png.ts
export default defineTool({
  slug: "jpg-to-png",        // unique — this IS the route /tools/jpg-to-png
  category: "image",
  title: "JPG to PNG",
  description: "...",        // SEO copy and page heading
  accepts: ["jpg"],
  produces: "png",
  options: z.object({ /* ... */ }),  // zod v4; .meta() drives the form
  defaults: { /* ... */ },
  pipeline: [{ op: "transcode", candidates: [{ engine: "canvas" }] }],
  batch: true,
});
```

From that single file, `pnpm gen` derives:

| Derived thing | From |
|---|---|
| The route `/tools/jpg-to-png` | `generateStaticParams` over the registry |
| The options form | zod schema + `.meta({label, control, unit})` |
| Category and index pages | grouping over `category` |
| SEO metadata | `title` / `description` |
| Engine preloads and SW cache list | `pipeline` → `manifest.ts` |

**This is the point.** Adding a conversion is one data file plus `pnpm gen` —
no route, no form, no test harness to hand-write. The
[add-converter](../.claude/skills/add-converter/SKILL.md) skill walks it.
Long form: [ADDING_A_TOOL.md](ADDING_A_TOOL.md).

Generated files (`src/tools/index.ts`, `src/lib/engines/manifest.ts`) are
**checked in**, and CI fails if `pnpm gen` produces a diff. Generated-but-
committed keeps the build hermetic while still letting a reviewer see the
output in the diff.

### Formats are sniffed, not trusted

`src/lib/registry/formats.ts` maps each `FormatId` to extension, MIME type, and
**magic bytes**. A file named `.png` that is really a JPEG is detected as a
JPEG. Extensions are a naming hint; the first bytes are the truth.

---

## Engines

An engine is a codec or library that does the actual work — canvas, jSquash,
mediabunny, ffmpeg.wasm, pdf-lib, tesseract. Each sits behind one adapter:

```ts
interface EngineAdapter {
  id: EngineId;
  version: string;                 // must match the asset path segment
  supports(op: Operation, input: StepFormat, output: StepFormat): boolean;
  load(ctx: EngineLoadContext): Promise<EngineInstance>;
}

interface EngineInstance {
  run(task: EngineTask): Promise<EngineResult>;
  dispose(): void;
}
```

Three rules, all enforced mechanically:

1. **Adapters are imported only by dynamic `import()` inside a worker.** The
   main thread never imports one. It sees only the generated `manifest.ts`
   (`{id, url, bytes, license, needsIsolation, location}`) — enough to show a
   download size, preload, and tell the service worker what to cache.
2. **No engine may appear in a core chunk.** `scripts/check-sizes.ts` walks the
   chunk graph in CI and fails the build if one does.
3. **Assets are versioned in the path** — `public/engines/<id>@<ver>/...` — so
   every engine URL is immutable and cacheable forever.

Engines ≤20 MiB ship as static assets. Larger ones (ffmpeg core-mt ~32 MB,
LibreOffice ~80 MB) live in R2 under `xl/<id>@<ver>/` and are fetched on demand
behind an explicit user gate. See [ENGINES.md](ENGINES.md) for the table and
[ADR-0003](adr/0003-workers-static-assets-over-pages.md) for why.

Adapter and worker code type-checks under a second, narrower `tsc` program
(`tsconfig.worker.json`, `lib: [WebWorker, ES2023]`) instead of the root
`DOM`-lib program, so `document`/`window` inside an engine or worker file is a
compile error rather than a runtime surprise. See
[ADR-0005](adr/0005-worker-typecheck-program.md).

### The router picks the engine at runtime

`src/lib/router/` probes what the browser can actually do — WebCodecs,
`SharedArrayBuffer`, `crossOriginIsolated`, `OffscreenCanvas`, OPFS — and walks
the tool's `pipeline` candidates in order, taking the first whose `when(probe)`
passes. A tool declares *preference*; the router resolves *capability*. Same
tool definition, different engine on different browsers, no branching in the
tool file.

### Image pipeline

Image tools don't convert format A straight to format B in one engine call.
Instead a pipeline runs **decode → transform\* → encode**, all inside one
worker, passing a decoded-pixels intermediate (`RasterImage`, RGBA 8-bit)
between steps by reference — never transferred, never structured-cloned.
`StepFormat` (a `FormatId`, or `"raster"`) is what a step's input/output
actually is; `decode` goes (format → raster), `encode` goes (raster →
format), and `resize`/`rotate`/`crop` go (raster → raster). A tool file stays
data: `pipeline: imagePipeline("heic", "jpg")` builds the steps and their
engine candidates from a codec preference table, instead of every tool
hand-listing candidates for a conversion an N×M table of adapters would
otherwise require. See [ADR-0007](adr/0007-raster-pipeline.md) for the full
design and its trade-offs.

---

## Concurrency and memory

- Workers are **lazy module workers**, pooled at
  `min(4, hardwareConcurrency - 2)`.
- Heavy engines (ffmpeg, tesseract, LibreOffice) get a **pinned worker with a
  60 s idle TTL**, then the worker is terminated. Terminating the worker is the
  only reliable way to reclaim an Emscripten heap; `dispose()` alone leaks.
- Per-category concurrency: images and PDF use the whole pool; video, audio and
  office run **one at a time** — each already saturates CPU and memory.
- The `File` handle is passed to the worker, not its bytes. Structured clone
  transfers the handle, so a 2 GB video costs nothing to hand over.
- Results come back as a **transferred** `ArrayBuffer`, a transferable stream,
  or an OPFS path for very large outputs (~200 MB+ spills to disk).
- Batch conversion runs sequentially into a streaming ZIP (fflate) piped to a
  File System Access handle where available — peak memory stays at roughly one
  file, not the whole batch.
- Cancel: `AbortSignal` for JS-side work; `worker.terminate()` and respawn for
  wasm already inside a synchronous encode loop, which cannot be interrupted
  any other way.

---

## Delivery

Next.js with `output: "export"` produces a fully static `out/`. A single
Cloudflare Worker serves it using static assets, with an R2 bucket bound for
oversized engines on the **same origin**. Same origin matters:
`connect-src 'self'` would otherwise block them, and widening the CSP is not on
the table.

`public/_headers` carries COOP/COEP — required for `SharedArrayBuffer`, so
multithreaded wasm works — and the CSP. Serwist provides the service
worker (`src/sw.ts`, registered from a small client component in
`src/app/layout.tsx`, production builds only): precache the app shell
(every page, `_next/static` JS/CSS), `CacheFirst` on `/engines/*` with no
expiry since those URLs are immutable by construction, and a
network-then-`/offline`-fallback for navigations that aren't precached —
so an online visitor to a genuinely missing route still gets a real 404,
and only an offline one sees the fallback page.

`pnpm build` runs three steps in order — `next build`, then
`scripts/csp-inline-hashes.ts`, then `scripts/build-sw.ts` — and the order
is load-bearing. `@serwist/turbopack`'s usual integration bakes its
precache manifest during `next build`'s own static-generation phase, before
`out/` exists and before the CSP step has touched a byte; a manifest built
that early would carry HTML revisions hashed from pre-injection bytes,
which stop matching the moment csp-inline-hashes.ts rewrites every page's
`<head>`. So `scripts/build-sw.ts` doesn't use that Route-Handler
integration at all — it calls `@serwist/turbopack`'s `createSerwistRoute`
directly, as a plain post-build script, pointed at the real `out/`
directory instead of `.next/`, after both earlier steps have already run.
It also refuses to run (exit 1) if any `out/**/*.html` is missing its
injected CSP `<meta>` tag, as a mechanical guard against the two steps
ever being reordered.

The CSP itself is two layers. The header CSP in `public/_headers` is tolerant
of inline scripts (`'unsafe-inline'`) because Next's static export inlines a
small hydration script on every page; `pnpm build` then runs
`scripts/csp-inline-hashes.ts`, which injects a per-page `<meta>` CSP
allow-listing only that page's own inline scripts by sha256 hash, closing the
gap the header leaves open. See
[ADR-0006](adr/0006-two-layer-csp.md).

---

## Invariants

Break one of these and the product is a different product.

1. **No network I/O with user file data, ever.** `connect-src 'self'` in
   `public/_headers` means the page *physically cannot* upload a file. This is
   the whole value proposition — a claim anyone can verify in devtools. Never
   widen it.
2. **No decode, encode, or zip on the main thread.** The main thread does DOM
   and object URLs. A dropped frame is a bug; a frozen tab is a broken product.
3. **No engine in the core bundle.** Dynamic import inside a worker, always.
   CI enforces it.
4. **Static export only.** No API routes, no server components reading runtime
   data, no Node built-ins in app code. `next build` must succeed under
   `output: "export"`.
5. **Core first-load JS ≤300 KB gzipped.** Enforced in CI. The app shell loads
   fast on a phone; engines arrive only when a user asks for one.

---

## Where things live

| Path | What |
|---|---|
| `src/tools/**` | The registry. Data files, one per conversion. |
| `src/lib/registry/` | `ToolDefinition`, categories, format table with magic bytes |
| `src/lib/engines/**` | Engine adapters. Dynamic-imported from workers only. |
| `src/lib/jobs/` | Job engine, queue, progress, store |
| `src/lib/workers/` | Worker pool, Comlink RPC |
| `src/lib/router/` | Capability probes, engine selection |
| `src/lib/sinks/` | Blob, streaming ZIP, File System Access, OPFS |
| `src/app/` | Routes, all statically generated from the registry |
| `scripts/` | `gen-registry`, `sync-engines`, `upload-r2`, `check-sizes` |
| `infra/` | Cloudflare Worker + `wrangler.jsonc` |

## Why it is this way

Architectural decisions are recorded in [adr/](adr/), one short file each.
Start with [0001-client-side-only](adr/0001-client-side-only.md).

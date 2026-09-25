# Engines

An engine is the codec or library that does the actual work. Every engine is
behind an adapter in `src/lib/engines/`, dynamic-imported **only** from inside
a worker.

**Update this file when you add or upgrade an engine.** The
[add-converter](../.claude/skills/add-converter/SKILL.md) skill reads the
capability table below to decide whether a requested conversion is even
possible — a missing row means an agent will refuse a tool it could have built,
and a wrong row means it will build one that cannot work.

Licenses are tracked separately and in more detail in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). The GPL isolation strategy
is [ADR-0002](adr/0002-mit-license-gpl-isolation.md).

---

## Capability table

What each engine can convert. This is the table to check before adding a
tool. Image engines run ADR-0007's decode → transform\* → encode pipeline, so
their row is shaped that way — what a format the engine can turn into pixels,
what it can turn pixels back into, and which of resize/rotate/crop it can do.
`imagePipeline` (`src/lib/registry/image-pipeline.ts`) reads this same shape
as its codec preference table.

| Engine | Decodes | Encodes | Transforms | Status |
|---|---|---|---|---|
| `canvas` | jpg, png, webp, bmp, gif | jpg, png, webp | resize, rotate, crop | adapter ready (0.5a) |
| `jsquash-jpeg` | jpg | jpg | — | adapter ready |
| `jsquash-png` | png | png | — | adapter ready |
| `jsquash-webp` | webp | webp | — | adapter ready |
| `jsquash-resize` | — | — | resize | adapter ready |
| `jsquash-avif` | avif | avif | — | adapter ready |
| `jsquash-jxl` | jxl | jxl | — | adapter ready |
| `resvg` | svg | — | — | adapter ready |
| `psd` | psd | — | — | adapter ready |
| `heic` | heic, heif | — | — | adapter ready |
| `utif` | tiff | — | — | adapter ready |

`canvas` also still runs the legacy single-step `transcode` op directly
(bytes of one format straight to bytes of another) for a tool that predates
ADR-0007 and doesn't need the raster split — see `EngineAdapter.supports` in
`src/lib/engines/canvas/adapter.ts`.

`jsquash-webp` wraps libwebp's own decoder/encoder instead of the browser's
built-in webp support `canvas` uses — smaller, more consistent output across
browsers, and works in browsers with no native webp encoder. `jsquash-resize`
wraps a dedicated Lanczos3 resize kernel instead of `<canvas>`'s `drawImage`
scaling — sharper downscaling at a similar cost. Both share
`src/lib/engines/shared/resize-box.ts` with `canvas` for the resize
width/height/fit/allowUpscale math, so a resize step produces the same output
size regardless of which of the two resize-capable engines the router picks.
`jsquash-avif` and `jsquash-jxl` each ship only their single-threaded
decode/encode wasm — never the multi-threaded variants jSquash's own
`wasm-feature-detect`-based auto-selection would otherwise pick — so both
stay `needsIsolation: false` and never depend on `crossOriginIsolated`.

`resvg` and `psd` are decode-only: they turn their format into a
`RasterImage` and nothing else, per the codec preference tables in
`src/lib/registry/image-pipeline.ts` — an `encode` step to any output format
still comes from a codec that can encode (jSquash, `canvas`, ...). `resvg`
loads no system fonts (`font.loadSystemFonts: false` — a worker has none to
load), so SVG text without an embedded font does not render; bundling a
default font is future work. `psd` only decodes 8-bit, non-CMYK image data —
the limits of `@webtoon/psd`'s own decoder. `heic` and `utif` are
decode-only too: `heic` wraps `heic-to`, LGPL — see ADR-0002 and the
copyleft table in THIRD_PARTY_LICENSES.md — via its `heic-to/next`
worker-safe build, hands back an `ImageBitmap` directly (`type: "bitmap"`,
no lossy intermediate re-encode), then reads it down to raw pixels through
OffscreenCanvas the same way every other decode-only engine here does.
`utif` decodes only the first page/frame of a TIFF, matching ADR-0007's
general "first frame only" rule for any multi-frame source.

---

## Delivery table

Size, placement, threading. Placement is enforced by `scripts/sync-engines.ts`:
**≤20 MiB → static** (`public/engines/<id>@<ver>/`), **larger → R2**
(`xl/<id>@<ver>/`), because static assets have a hard 25 MiB per-file limit
([ADR-0003](adr/0003-workers-static-assets-over-pages.md)).

`Isolation` means the engine needs `SharedArrayBuffer`, so it only runs when
`crossOriginIsolated` is true. Our origin always is (COOP/COEP in
`public/_headers`), but the router still probes so `next dev` keeps working.

| Engine | Package | Version | License | Size | Placement | Isolation |
|---|---|---|---|---|---|---|
| `canvas` | _(native browser API)_ | — | — | 0 | native | no |
| `jsquash-jpeg` | `@jsquash/jpeg` | 1.6.0 | Apache-2.0 | ~0.4 MiB (dec + enc wasm) | static | no |
| `jsquash-png` | `@jsquash/png` | 3.1.1 | Apache-2.0 | ~0.2 MiB | static | no |
| `jsquash-webp` | `@jsquash/webp` | 1.5.0 | Apache-2.0 | ~135 KB decode + ~275/338 KB encode (non-SIMD/SIMD variant) | static | no |
| `jsquash-resize` | `@jsquash/resize` | 2.1.1 | Apache-2.0 | ~34 KB | static | no |
| `jsquash-avif` | `@jsquash/avif` | 2.1.1 | Apache-2.0 | ~4.4 MiB (dec + enc wasm, single-threaded only) | static | no |
| `jsquash-jxl` | `@jsquash/jxl` | 1.3.0 | Apache-2.0 | ~2.1 MiB (dec + enc wasm, single-threaded only) | static | no |
| `resvg` | `@resvg/resvg-wasm` | 2.6.2 | MPL-2.0 | ~2.4 MiB | static | no |
| `psd` | `@webtoon/psd` | 0.4.0 | MIT | 0 (bundled in JS) | bundled | no |
| `heic` | `heic-to` | 1.5.2 | **LGPL-3.0** | 0 (bundled in JS) | bundled | no |
| `utif` | `utif2` | 4.1.0 | MIT | 0 (bundled in JS) | bundled | no |

### How engine assets ship

A "static" or "r2" engine's `engine.json` names its own source: `package`
(the npm package the assets come from) and `files` (each one's `{from, to}` —
`from` relative to the package's own directory, `to` the filename under the
engine's asset directory). Both are required for "static"/"r2" and forbidden
for "native" or "bundled" — neither ships assets of its own: "native" wraps a
browser API, "bundled" is pure JS shipped inside the engine's own worker
chunk instead of a separate fetched asset. `version` must equal the
installed package's version — engine URLs are versioned by it.

`pnpm sync-engines` reads those fields, copies each file into place
(`public/engines/<id>@<version>/` for "static", `.engines-r2/xl/<id>@<
version>/` — a gitignored staging area — for "r2"; a "native" or "bundled"
engine has nothing to copy and is skipped), and rewrites
`engine.json`'s `assets` to the real `{path, bytes}` list before running
`pnpm gen` to rebuild `manifest.ts`. It enforces the placement rule above
mechanically: a "static" file over 20 MiB fails the command outright
("set location to r2"); an "r2" engine whose files are all comfortably under
20 MiB gets a warning to reconsider "static" instead. `pnpm build` runs it
automatically.

`pnpm upload-r2` uploads whatever `sync-engines` staged in `.engines-r2/xl/`
to the `localvert-engines` R2 bucket, keyed `xl/<id>@<version>/<file>` —
exactly what `infra/worker/index.ts` serves. Every key is versioned, so an
object that already exists is already correct; the CI deploy job re-runs
`sync-engines` to restage `.engines-r2/` (gitignored, not part of the build
artifact) before calling it.

---

## Planned

Not yet integrated. Each needs the
[add-engine](../.claude/skills/add-engine/SKILL.md) checklist — license review
first, then adapter, wiring, size budget, docs.

| Engine | For | License | Approx size | Phase |
|---|---|---|---|---|
| `libraw-wasm` | Camera raw | LGPL-2.1 | ~2 MB | 1 |
| `@cantoo/pdf-lib` | PDF manipulation | MIT | small | 2 |
| `pdfjs-dist` | PDF render to image | Apache-2.0 | ~2 MB | 2 |
| `@embedpdf/pdfium` | PDF compression | Apache-2.0 / BSD-3 | ~10 MB | 2 |
| `tesseract.js` | OCR | Apache-2.0 | core + traineddata | 2 |
| `mediabunny` | Video/audio via WebCodecs — **primary path** | MIT | small | 3 |
| `@ffmpeg/core-mt` | avi, wmv, flv, GIF out — **fallback only** | **GPL-2.0+** | ~32 MB → **R2** | 3 |
| `typst.ts` | Markdown to PDF | Apache-2.0 | ~10 MB | 4 |
| `@bentopdf/libreoffice-wasm` | Office to PDF, **opt-in gate** | MPL-2.0 | ~80 MB → **R2** | 4 |

---

## Rules

1. **Dynamic import from a worker only.** The main thread never imports an
   adapter. It sees the generated `manifest.ts` and nothing else.
2. **No engine in a core chunk.** `scripts/check-sizes.ts` fails the build.
3. **Version in the asset path** — `<id>@<ver>/` — so every URL is immutable
   and cacheable forever. The adapter's `version` must match the path segment.
4. **Self-host everything.** Several of these libraries fetch assets from a CDN
   by default; `tesseract.js` is the notable one, fetching worker, core and
   traineddata. `connect-src 'self'` blocks that, which is the point. Configure
   local paths, or the engine fails at runtime in production while working in
   dev.
5. **Terminate the worker to free the heap.** For Emscripten-based engines,
   `dispose()` does not reclaim memory. Heavy engines get a pinned worker with
   a 60 s idle TTL, then `worker.terminate()`.
6. **License review comes first**, before any code. Non-OSI licenses stop the
   work and go to the owner.

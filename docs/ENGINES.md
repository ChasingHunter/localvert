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
| `tracer` | — | svg | — | adapter ready |
| `exif` | — | — | `strip`: jpg, png, webp | adapter ready |
| `libraw` | raw | — | — | adapter ready |
| `pdf-lib` | jpg, png (`merge` only) | — | `merge`, `split`, `rotate`, `extract`, `protect`, `unlock`, `compress`: pdf | adapter ready |
| `pdfjs` | — | — | `render`: pdf → jpg, png | adapter ready |
| `tesseract` | — | — | `ocr`: jpg, png, webp, bmp → txt, pdf | adapter ready |

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
general "first frame only" rule for any multi-frame source. `libraw` wraps
`libraw-wasm` (LibRaw), LGPL-2.1/CDDL-1.0 — see ADR-0002 and the copyleft
table in THIRD_PARTY_LICENSES.md — decoding camera raw with camera white
balance, sRGB output and 8-bit samples; an `options.halfSize` switch asks for
LibRaw's own faster half-resolution decode. It bypasses `libraw-wasm`'s own
`index.js`/`worker.js` entry point (which spawns a nested Worker and resolves
its wasm relative to its own bundled URL, with no hook to redirect it) and
instead imports the lower-level Emscripten glue directly, pointing its
`locateFile` hook at this engine's own `ctx.baseUrl` — see the adapter's own
`load` doc comment for the full reasoning. A decode over 60 MP is rejected
before the expensive demosaic runs (`RasterImage` is 4 bytes/pixel), and
anything other than 8-bit RGB output (LibRaw's default) is rejected too.

`tracer` is encode-only, and the odd one out among the encoders: every other
`encode` step re-encodes pixels into a raster format's bytes (jSquash,
`canvas`); `tracer` (`@image-tracer-ts/core`) instead traces color-region
outlines from the decoded `RasterImage` into SVG `<path>`s — a genuinely
different output shape (vector, not raster), which is why it's the sole
candidate for `svg` in `ENCODE_PREFERENCE` (`src/lib/registry/
image-pipeline.ts`) with no jSquash/`canvas` fallback. A raster wider or
taller than `options.maxSize` (default 1600 px, same knob every `*-to-svg`
tool exposes) is downscaled first via `OffscreenCanvas` — tracing cost grows
fast with pixel count, and a full-resolution trace of a large photo would be
both slow and produce an unusably large SVG.

`exif` doesn't fit the decode/encode/transform shape at all — its one op,
`strip`, is byte-to-byte (format in, the same format out, no raster
intermediate): it walks a JPEG/PNG/WebP's marker/chunk structure and drops
the metadata segments (EXIF incl. GPS, XMP, IPTC, PNG text/time chunks),
keeping the ICC colour profile and the image data itself untouched and
unre-encoded. See `src/lib/engines/exif/strip.ts`.

`pdf-lib` (ADR-0008) is another byte-to-byte engine, not a raster pipeline:
`merge` copies every page of every input, in the user's own order, into one
new document (`EngineTask.inputs`, a many-to-one step) — or, given jpg/png
inputs instead of pdf, embeds each image as its own new page
(`images-to-pdf`), sniffing every input's own bytes rather than trusting the
job's single aggregate `inputFormat`. `split` copies pages out of one input
into N new documents (`EngineResult`'s `"files"` kind, a one-to-many step) —
either every page as its own file (`mode: "each"`), or one file per
`;`-separated segment of `options.ranges`, each segment itself parsed by the
shared `parsePageRange` (`src/lib/registry/page-range.ts`). `rotate` adds
`options.angle` to a page's existing rotation rather than replacing it.
`extract` is one implementation behind two tools, `options.mode: "keep"`
(extract-pdf-pages) or `"remove"` (delete-pdf-pages). `protect`/`unlock` add
and remove AES-256 password encryption; a wrong `unlock` password is
`EngineError("decode-failed", "Wrong password")`, and `unlock` has to clean
up an orphaned encryption-dictionary object `@cantoo/pdf-lib` 2.11.1 itself
leaves behind after a password-based load (see `stripOrphanedEncryptDict`'s
doc comment in the adapter). It is pure JS (no wasm), so — like
`psd`/`tracer`/`utif`/`exif` — it ships `location: "bundled"`, no separate
fetched assets. A password-protected input to merge/split/rotate/extract
fails with `EngineError("unsupported", ...)` rather than being silently
skipped; unlock it first.

`pdfjs` (ADR-0008) is the one raster-producing PDF engine: `render` turns a
PDF page into a `RasterImage`-shaped output, but as `EngineResult`'s `"files"`
kind directly (one JPG/PNG per page, a one-to-many step) rather than through
the shared `RasterImage` intermediate — a page render already needs its own
`OffscreenCanvas` and encode step per page, so routing it through ADR-0007's
raster pipeline would buy nothing. It never spawns pdf.js's own dedicated
Worker: `pdf.js` is loaded and run inside *our* worker instead, wired to its
"fake worker" (in-thread, `LoopbackPort`) mode by importing `pdf.worker.mjs`
directly and assigning it to `globalThis.pdfjsWorker` before calling
`getDocument()` — see the adapter's `load` doc comment for the full mechanism
and why it's not a Turbopack-hang risk the way `libraw`'s Emscripten glue is.
Because pdf.js's default `CanvasFactory`/`FilterFactory` both assume a DOM
`document` (for `<canvas>` creation and SVG colour filters respectively,
neither of which exists in a worker), the adapter supplies its own
`OffscreenCanvas`-backed `CanvasFactory` and a no-op `FilterFactory`.
`options.pages` (the shared page-range spec) selects which pages render;
`options.dpi` (72–300, scale = dpi/72) and `options.quality` (jpg only)
control resolution and compression. jpg output is filled `#ffffff` first
(via pdf.js's own `render({background})`, since jpg has no alpha channel);
png keeps whatever transparency the page content itself has. A page over
8192px on either side, or a job selecting over 200 pages, fails with a clear
`EngineError("unsupported", ...)` rather than attempting the render. A
password-protected PDF fails the same way as `pdf-lib`'s ops — "unlock it
first". Its cmaps and standard fonts (for non-embedded-font PDFs, and CJK
text via predefined Adobe CMaps) ship as real per-file assets under
`ctx.baseUrl` — `scripts/sync-engines.ts` gained directory-entry support
(`{from: "cmaps/", to: "cmaps/"}`) to copy pdf.js's own directory trees of
them one file at a time, same as every other engine's fixed file list.

`tesseract` (`tesseract.js`, wrapping the Tesseract OCR engine) doesn't fit
the decode/encode/transform shape either — its one op, `ocr`, hands an image
straight to tesseract.js's own `recognize()` (which does its own decoding)
and reads back either plain text or a searchable PDF (the original page
image plus an invisible OCR text layer, via `recognize({pdf: true})`). It is
`heavy: true`: `load()` spins up **one** real nested `Worker` (tesseract.js's
own — a same-origin worker inside our worker, allowed by ADR-0006's
`worker-src 'self' blob:`) and loads the wasm core plus the English language
model into it once, reused across every `run()` this adapter instance
handles rather than per job — the entire reason `heavy` engines get a pinned
worker with an idle TTL instead of loading fresh every call. `workerPath`/
`corePath`/`langPath` all point at this engine's own `ctx.baseUrl`, never
tesseract.js's jsdelivr CDN defaults. `corePath` is passed as an exact
`.wasm.js` file rather than a directory: tesseract.js's own worker-side core
loader (`getCore.js`) otherwise probes for a browser's SIMD *and*
relaxed-SIMD support and, on a browser that reports the latter (current
Chromium does), tries to fetch a `-relaxedsimd-` core file that
`tesseract.js-core`@6.1.2 (the installed version) predates and never built —
confirmed failing against a real Chromium run. A local `WebAssembly.validate`
SIMD probe (the same bytes `wasm-feature-detect`'s own check uses)
picks between the two tiers this engine actually ships instead: the
SIMD-LSTM core for the common case, plain LSTM as the no-SIMD fallback.
tesseract.js's package entry point requires a Node-only module unless a
bundler honours its `package.json` `"browser"` field remap — unverified for
a Turbopack worker bundle — so this adapter ships tesseract.js's own prebuilt
`dist/tesseract.esm.min.js` browser bundle as a static asset and
runtime-imports it instead, the same pattern as `pdfjs`/`libraw`. Uses the
smaller "best_int" English language model (`@tesseract.js-data/eng`'s
`4.0.0_best_int` variant, ~3 MB gzipped) rather than the full ~11 MB one.
Multi-page scanned-PDF → searchable-PDF (rendering each page with `pdfjs`
first, OCR-ing each, then merging) is future work — the current tools take a
single page image, not a PDF.

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
| `tracer` | `@image-tracer-ts/core` | 1.0.2 | MIT | 0 (bundled in JS) | bundled | no |
| `exif` | _(our own code)_ | 1.0.0 | MIT | 0 | bundled | no |
| `libraw` | `libraw-wasm` | 1.6.0 | **LGPL-2.1/CDDL-1.0 dual** | ~1.4 MiB | static | no |
| `pdf-lib` | `@cantoo/pdf-lib` | 2.11.1 | MIT | 0 (bundled in JS) | bundled | no |
| `pdfjs` | `pdfjs-dist` | 6.3.289 | Apache-2.0 | ~4.8 MiB (pdf.mjs + pdf.worker.mjs + cmaps + standard_fonts) | static | no |
| `tesseract` | `tesseract.js` (+ `tesseract.js-core`, `@tesseract.js-data/eng`) | 7.0.0 | Apache-2.0 (data: MIT) | ~16 MiB (JS glue + worker + 2 wasm core tiers + English "best_int" model) | static | no |

### How engine assets ship

**Versions and asset sizes are derived, never hand-written.** A Dependabot
bump of an engine's npm package needs zero manual edits — no `engine.json`
change, no regenerated file to commit — because neither field lives in a
file we commit:

- A "static" or "r2" engine's `engine.json` names its source: `package` (the
  npm package the assets come from) and `files` (each one's `{from, to}` —
  `from` relative to the package's own directory, `to` the filename under
  the engine's asset directory). Both are required for "static"/"r2". Its
  **version is always the installed `package`'s own version** — `engine.json`
  may not declare a `version` field at all; `pnpm gen` rejects one if present,
  to keep exactly one source of truth. Engine URLs are versioned by this
  derived value (`<id>@<installed-version>/`).
- A "bundled" engine (pure JS in its own worker chunk, no separate fetched
  asset) is either our own code — a hand-written `version` in `engine.json`,
  bumped by hand when the code changes (e.g. `exif`) — or a thin wrapper
  around one npm package, in which case `versionFrom` names that package and
  the version is derived from it exactly like `package` above (e.g. `heic`'s
  `versionFrom: "heic-to"`). Exactly one of `version`/`versionFrom` is
  required; `pnpm gen` rejects either combination that isn't.
- A "native" engine (wraps a browser API, ships nothing) always has a
  hand-written `version` — there is no installed package to derive it from.
- `assets` (each file's `{path, bytes}`) is **never** written in
  `engine.json` for any location — `pnpm gen` computes it by `stat`ing the
  real file directly in the source npm package (no copy needed for that),
  and rejects an `engine.json` that declares it.

A file entry can also carry its own `package`, overriding the engine's
top-level one for that one file — for an engine whose assets are split
across several npm packages, like `tesseract` (`tesseract.js` for the JS
glue, `tesseract.js-core` for the wasm, `@tesseract.js-data/eng` for the
language data). Only the engine's own top-level `package` (or `versionFrom`)
ever decides the version; a borrowed file's own package version is
irrelevant to it.

`pnpm sync-engines` copies each "static"/"r2" engine's files into place
(`public/engines/<id>@<version>/` for "static", `.engines-r2/xl/<id>@<
version>/` — a gitignored staging area — for "r2"; a "native" or "bundled"
engine has nothing to copy and is skipped), reading the same installed
package's version `pnpm gen` derives independently. It enforces the
placement rule above mechanically: a "static" file over 20 MiB fails the
command outright ("set location to r2"); an "r2" engine whose files are all
comfortably under 20 MiB gets a warning to reconsider "static" instead. It
also removes a stale `public/engines/<id>@<oldVersion>/` directory once a
version has moved on. `pnpm build` runs it automatically, chained into
`pnpm gen` to rebuild `manifest.ts` from the freshly copied files.

`src/lib/engines/manifest.ts` (the `ENGINE_MANIFEST` `pnpm gen` writes) is
**gitignored, not committed** — it's build output, regenerated by the
`postinstall` script on every `pnpm install` (a fresh clone included) and
again by `pnpm check`/`pnpm build`. `src/lib/engines/{ids,loaders}.ts` and
`src/tools/{index,loaders}.ts` stay committed: unlike `manifest.ts`, nothing
in them depends on an installed package's version, so they only change when
a tool or engine is actually added or removed — CI's "Generated files are up
to date" check still catches a forgotten registration, without ever failing
on a routine dependency bump.

An adapter that needs its own resolved `version` at runtime (every
"static"/"r2" engine, and every "bundled" engine with `versionFrom`) reads it
from `ENGINE_MANIFEST` rather than from `engine.json` directly — see any of
those adapters' `metadata` constant for the pattern. Only `canvas` and `exif`
(hand-written `version`, no installed package to derive from) read `version`
straight off their own `engine.json`.

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

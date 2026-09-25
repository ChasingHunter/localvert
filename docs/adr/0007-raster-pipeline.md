# ADR-0007: Images convert through a raster pipeline, not codec pairs

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

Phase 1 brings about twenty image conversions across ten formats: jpg, png,
webp, avif, jxl, heic, svg, tiff, psd and camera raw. They come from several
engines. mozjpeg, oxipng, libwebp, libavif and libjxl come from jSquash;
heic-to, resvg, utif2, @webtoon/psd and libraw-wasm add a decoder each, and
none of those five can encode anything we output.

Until now a tool had one pipeline step and each step resolved to one engine,
so an engine had to convert A→B by itself. That works for `canvas`, which does
both sides. It does not work for heic→jpg (heic-to decodes, mozjpeg encodes)
or for any format pair that spans two libraries. Writing a dedicated adapter
per pair would take N×M adapters, or engines that secretly import each other.

Every one of these conversions has the same shape: decode to pixels, optionally
transform (resize, rotate, crop), then encode.

## Decision

Image tools run a multi-step pipeline, **decode → transform* → encode**,
executed inside **one worker**. Steps pass a raster intermediate in memory:

```ts
interface RasterImage { width: number; height: number; data: Uint8ClampedArray } // RGBA, 8-bit
```

- New operations `decode`, `encode`, `resize`, `rotate`, `crop`. An engine
  declares which formats it can decode and which it can encode. The router
  already resolves each step independently, from its own candidates.
- `EngineTask.input` gains `{ kind: "raster" }`, and `EngineResult` gains
  `{ kind: "raster" }`. Only encode steps produce bytes.
- The job engine sends the **whole resolved pipeline** in one request. The
  engine host runs the steps in order in the same worker, so pixels never
  cross a thread boundary or a structured clone.
- A registry helper, `imagePipeline(from, to, transforms?)`, builds the steps
  and their engine candidates from a codec preference table. Tool files stay
  data: `pipeline: imagePipeline("heic", "jpg")`.
- Codec preference goes to the dedicated codec first (mozjpeg, oxipng,
  libwebp, libavif, libjxl) and falls back to `canvas` wherever the browser
  can decode or encode that format natively.

Tools that can keep the file's bytes, such as lossless EXIF stripping, still
use a single byte-to-byte step. The raster path is for conversions, not a
requirement for every tool.

## Consequences

**What it buys**

- N decoders + M encoders instead of N×M adapters. A new input format is one
  decode-only adapter, and it can reach every output format at once.
- Transforms are written once and work for every format.
- Each engine stays small and single-purpose, and loads only when its step
  runs.

**What it costs**

- A full RGBA frame is held in memory: 4 bytes per pixel, so about 190 MB for
  a 48 MP camera raw. Pipelines stay sequential inside a worker, and the pool
  limits parallelism, so peak memory is bounded per worker and not per batch.
  Very large inputs will need tiling later.
- Metadata that a decode→encode round trip drops (EXIF, ICC profiles) is gone
  unless it is carried across on purpose. Stripping EXIF by default is the
  privacy stance we want anyway. ICC-aware colour handling is future work, and
  wide-gamut sources may shift slightly.
- Animated sources (GIF, animated WebP/AVIF) convert as their first frame
  only.

## Alternatives considered

**Per-pair adapters.** Rejected: N×M growth, duplicated code in every
adapter, and every new format touches many files.

**One "image" mega-engine that bundles every codec.** Rejected: it would
download or evaluate codecs the conversion doesn't need, and it would hide
licensing boundaries (heic-to's LGPL) inside one module. ADR-0002 depends on
keeping those boundaries visible.

**Pass the intermediate between workers.** Rejected: pixels would have to be
copied or transferred, and heavy engines would need cross-worker
coordination. It gains nothing while every codec here is light enough to share
a worker.

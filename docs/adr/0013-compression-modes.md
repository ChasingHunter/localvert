# ADR-0013: Compression modes — lossless by default, honest about the rest

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Every compress tool shipped so far (`compress-jpg`, `compress-webp`,
`compress-pdf`, `compress-video`) defaults to a lossy re-encode: a quality
number or a preset picked for a reasonable size/quality trade-off, with no
lossless option at all. That's a reasonable default for video (no practical
lossless path exists for delivery codecs), but for JPEG, WebP and PDF it's
not — a JPEG's own bytes can be losslessly repacked (metadata stripped, same
pixels) with zero quality cost, and nothing in the registry told a user that
was even possible. "Compress this" silently meant "degrade this a bit."

Separately, no compress tool guarantees its output is actually smaller. An
already-optimized PNG, a PDF with no images to shrink, or a WebP near its
format's own floor can all come back *larger* after a round trip through an
encoder — `compress-pdf`'s existing `runCompress` already guards against this
per-file, but nothing else does, and nothing tells the user when it happens.

## Decision

Every compress tool gets a `mode` select. The **default is lossless where the
format allows it**, otherwise the closest thing to it ("visually lossless": a
high-quality re-encode indistinguishable at normal viewing, not "smallest
possible file"). Stronger, visibly-lossy modes and a byte-budget target are
explicit choices, never the default:

| Tool | `lossless` (default unless noted) | other modes |
|---|---|---|
| `compress-png` | oxipng repack, metadata dropped, pixels bit-identical | `smaller` — image-q palette reduction (≤256 colours, optional dither) + oxipng |
| `compress-jpg` | metadata strip only (`exif` engine, byte-level, no re-encode) | `visually-lossless` (**default** — see below), `strong`, `custom`, `target-size` |
| `compress-webp` | metadata strip only | same four lossy modes as `compress-jpg` |
| _(webp lossless, expanded)_ | this is a byte-level strip, deliberately **not** `jsquash-webp`'s own encoder-level `lossless: true` — re-encoding an already-lossy WebP (a photo, the common case) losslessly re-derives every pixel exactly, which produces a *bigger* file than the lossy source, the opposite of what a compress tool promises |
| `compress-pdf` | pdf-lib re-save with object streams, no image recompression | `balanced`/`strong` — existing per-image JPEG re-encode |
| `compress-audio` | *(none — see below)* | bitrate select (64/96/128 kbps, default 96) + channel option |

**`compress-jpg`/`compress-webp` default to `visually-lossless`, not
`lossless`.** A JPEG/WebP's lossless mode here is metadata-only — it does not
shrink a file whose size lives almost entirely in its lossy pixel data, which
is the actual reason someone reaches for a "compress" tool. Defaulting to a
mode that usually saves almost nothing would violate the "pick the choice most
people want" rule defaults are held to just as much as the "lossless where
possible" one. `visually-lossless` is mozjpeg/libwebp at quality ≈0.85 (mozjpeg
"quality 85" is the commonly-cited threshold below which JPEG artifacts start
being visible on typical photos at normal viewing distance; the same value is
used for WebP for one predictable number across both tools) — a real size win
most people can't see the cost of. `compress-png`'s `lossless` stays the
default because oxipng repacking has no visible-difference tradeoff to weigh
at all: it's a strict win, always.

**Never return a file bigger than the input.** Every compress tool's engine
adapter compares its own output against the input it started from and returns
the input unchanged if the result isn't smaller — for an image tool, the
metadata-stripped input (never the re-encoded/quantized attempt) when that
comparison fails, since a metadata strip is itself an unconditional size-or-
smaller operation. `neverLarger` (`src/lib/engines/shared/never-larger.ts`) is
the shared helper this compares through. When the input wins, `EngineResult`'s
`bytes` case now carries an optional `note`, threaded through
`job-engine.ts` onto `Job.output.note` and rendered on the job card — the
first UI surface for "here's what actually happened," reusing the job card
rather than inventing a second status channel.

**Lossless JPEG re-optimization (`jpegtran`-style: same pixels, smaller
entropy coding) is not available.** It needs a wasm build under a licence this
project can ship in the core dependency tree; nothing in `package.json` today
qualifies, and vetting one is a real `add-engine` decision (license review,
size budget), not a side effect of this slice. `compress-jpg`'s `lossless`
mode is metadata-only until that engine exists — a real "reduce a JPEG's
bytes with literally zero visible change" mode is a documented follow-up, not
silently ignored.

## Consequences

**What it buys**

- A user who wants zero quality risk finally has a real option, on every
  tool where the format allows one, without hunting for it — it's the first
  thing the mode selector offers wherever `lossless` exists at all.
- The default answer to "will this tool ever make my file worse" is
  mechanically "no," not "we hope not" — every tool's own engine adapter
  enforces it against its own output, not left to reviewer discipline per
  tool.
- `compress-png`'s `smaller` mode gives png a genuinely large size win
  (unlike jpg/webp, PNG has never had a lossy option in this app at all)
  gated behind an explicit, named choice rather than silently degrading the
  default.

**What it costs**

- Five option shapes to maintain instead of one or two knobs each; `custom`
  still exists for anyone who wants direct quality control, so nothing that
  worked before regresses.
- `compress-jpg`/`compress-webp` doing a real lossless mode at all required
  reusing the `exif` engine's byte-level strip as a distinct, non-raster
  pipeline path alongside the existing decode → encode one — two genuinely
  different code paths behind one tool, not a single knob on one encoder call.
- The never-larger comparison is a second full-size buffer held in memory per
  job (the fallback candidate, computed unconditionally so it's ready the
  moment the primary result needs comparing) — negligible next to the raster
  intermediate ADR-0007 already accepts holding in memory, but not free.

## Alternatives considered

**Make `lossless` the default everywhere, including jpg/webp.** Rejected: see
above — it would silently do almost nothing for a JPEG/WebP compress tool,
which is a worse default than a real (if not perfectly lossless) size win.

**Wire in a lossless JPEG re-optimizer now (a jpegtran/mozjpeg
`-optimize`-only build).** Rejected for this slice: no permissively-licensed
wasm build was already in `package.json`, and licence review + size budgeting
for a new engine is its own decision under `add-engine`, not something to
fold into a compression-modes slice.

**Enforce "never bigger than the input" centrally, in `engine-host.ts`,
instead of per-adapter.** Rejected: `engine-host.ts` runs every tool's
pipeline, including plain format conversions (jpg→png) where the output being
a different size — bigger or smaller — is normal and expected, not a bug to
guard against. The rule is a property of *compress* tools specifically, so
each one's own adapter (which already knows it's being asked to shrink
something) is where the comparison belongs; `neverLarger` exists so that
comparison isn't hand-rolled five times.

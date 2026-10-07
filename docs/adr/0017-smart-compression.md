# ADR-0017: Smart compression: target size, percentage, and quality you can't see drop

- **Status:** Accepted
- **Date:** 2026-09-30
- **Extends:** [ADR-0013](0013-compression-modes.md)

## Context

The owner asked for three things (2026-09-30):

- More control: a target size ("20 MB means 19–20 MB, never over") and a
  percentage ("50% smaller").
- As little visible quality loss as possible, done smartly.
- A fix for compress-video, which turned a 37 MB already-compressed video into
  64 MB.

**Root cause of the 64 MB video.** Verified in
`mediabunny/dist/modules/src/encode.js`, `Quality` levels map to a fixed
quantizer wherever the browser supports `bitrateMode: "quantizer"`, with no
bitrate cap (H.264 ≈ 35/29/22). An efficiently encoded source therefore comes
out bigger.

**Research.** `.claude/plans/2026-09-30-compression-research.md`, private,
with sources. It covered FFmpeg target-size guides, 8mb.video, FreeConvert,
HandBrake, jpeg-recompress, pngquant/TinyPNG and Ghostscript presets.

**Current weaknesses:**

- **Image target size** (`src/lib/engines/shared/target-size.ts`) bisects a
  continuous quality for a fixed 8 encodes. It has no early stop and never
  downscales.
- **compress-pdf** re-encodes images with the browser's own JPEG encoder and
  caps them by pixels, not by DPI.

## Decision

### Modes, the same shape everywhere

Every compressor offers:

1. **Best quality**: the default, and still "never larger" (ADR-0013).
2. **Target size**: in KB or MB.
3. **Reduce by %**: 10–90%. It maps to target = source × (1 − p), then
   behaves exactly like target size.
4. The format-specific extras that already exist: lossless/metadata-only,
   custom quality, max resolution, bitrate.

### Result contract

Every result says one of three things, through the existing job-row `note`:

- **Hit:** "19.4 MB, 97% of your 20 MB target."
- **Hit with a compromise:** "Resized to 720p to fit 20 MB."
- **Unreachable:** "The smallest we could make it is 23 MB." The user can keep
  it or discard it.

A result over the target is never returned without saying so.

**Estimates.** Where the size is arithmetic (video, audio, PDF), the options
show an estimate before running. Examples: "About 19 MB at 1080p",
"About 12 MB, mono".

### Video (mediabunny / WebCodecs)

**Never pass a bare `Quality` level.** Always pass an explicit bitrate:
`bitrateMode: "variable"`, or quantizer mode only under the cap below.

**Best quality:**

- Ceiling = min(0.7 × source video bitrate, 0.15 bpp for H.264 or 0.09 bpp
  for VP9).
- **If the source is already below the ceiling:** encode at 0.7 × source.
- **Otherwise:** use quantizer mode (H.264 23, VP9 32) only in Chromium, else
  bitrate mode at the ceiling.
- **Audio:** passed through when it already fits, otherwise at no more than
  the source's audio bitrate.
- The never-larger fallback stays.

**Target size T (bytes):**

1. Reserve audio (128/96/64/48 kbps by budget, never above the source) and a
   container overhead of 2% of T + 32 KB.
2. Video bitrate = (0.95·T − audio − overhead) × 8 / duration, in variable
   bitrate mode.
3. Measure the real output. If it's over T, rescale the bitrate by
   0.97·T / actual and re-encode. At most 2 retries, or 1 for clips longer
   than 10 minutes.
4. If the result is under 0.85·T and the clip is 3 minutes or shorter, try
   once upward.
5. Show "Pass 2 of 3" progress.

**Resolution by bits per pixel** (bitrate / (w·h·fps)):

- Floors: H.264 0.07, VP9 0.045.
- Below the floor, step down source → 1080 → 720 → 540 → 480 → 360, then cap
  fps at 30, then 24.
- Below half the floor at 360p/24 fps, the target is unreachable. Say so and
  give the smallest sensible size.

### Images (mozjpeg / libwebp / oxipng + image-q)

**Best quality** is a perceptual search in the style of jpeg-recompress:

- Integer quality from 40 up to min(95, the source's own JPEG quality, read
  from its quantization tables).
- About 6 bisection encodes.
- Each candidate is scored by **SSIM on the luma plane, downscaled to at most
  1024 px**, in a worker.
- Pick the smallest candidate with SSIM ≥ 0.9999. "Smaller" mode uses
  ≥ 0.999.
- Golden-image tests pin the thresholds.

**Target size:**

- Search integer quality by interpolating on log(size) and stop in
  [0.95·T, T]. Typically 3–5 encodes, cap 8.
- If quality 30 still doesn't fit, downscale by sqrt(T/size) × 0.95, up to
  2 rounds, and report the new dimensions.
- WebP may use libwebp's own `target_size` if the tests show it's accurate.

**Encoder settings:**

- **mozjpeg chroma:** 4:2:0 for photos. 4:4:4 at quality ≥ 90 and for
  graphics or text (detected by colour count / edge heuristics). Progressive
  on.
- **WebP:** `method: 6`, and `use_sharp_yuv` for graphics.

**PNG:**

- An exact palette whenever there are 256 colours or fewer (lossless).
- A lossy palette only if SSIM ≥ 0.998.
- Target size and % step the colour count down (256 → 16). For photos, say
  that PNG can't reach the target and suggest JPG or WebP.

### Audio

- Bitrate = (0.97·T − 8 KB) × 8 / duration, snapped down to a supported rate.
- **Floors:** Opus 48 kbps stereo / 24 mono. AAC and MP3 64 stereo / 32 mono.
- Below the stereo floor, downmix to mono. Below the mono floor, the target
  is unreachable.

### PDF

- Re-encode embedded images with **mozjpeg**, not `convertToBlob`.
- Downsample by **effective DPI**: image pixels ÷ the size it's drawn at,
  read from the page's content streams when practical, otherwise the page
  size as the upper bound.
  - Balanced: 150 dpi, q 0.75.
  - Strong: 96 dpi, q 0.5.
- **Target size:**
  1. Subtract the non-image bytes first. If those alone exceed the target,
     say so.
  2. Otherwise walk the ladder (150, .8) (150, .65) (120, .6) (96, .5)
     (72, .45) (72, .35) and stop at the first result that fits.
  3. Expect 60–100% of the target. The note says what was reached.

## Consequences

- **What it buys:**
  - Predictable sizes.
  - A video bug class closed at the source.
  - Quality chosen by measurement, not by a guessed number.
- **Cost:**
  - More encodes per job: image searches take about 6, video targets up to
    3 passes, so progress UI matters.
  - SSIM code to own and test.
  - A per-browser encoder spread, which is why we always measure the output.
- **Unverified and to be checked in implementation:**
  - Safari quantizer support.
  - How far one-pass VBR overshoots.
  - SSIM cost in the worker.
  - The accuracy of WebP's built-in target size.
  - The lower limits of AAC per browser.

## Alternatives considered

- **HandBrake-style "constant quality only, no target size":** simpler, but
  the owner explicitly wants targets.
- **SSIMULACRA2 or butteraugli instead of SSIM:** better correlated with
  human vision, but a heavier wasm dependency. A possible phase 2 behind the
  same interface.
- **True two-pass video encoding:** WebCodecs has no two-pass API. Measure
  and re-encode is the practical equivalent.

## Addendum: estimates, and which modes stage a drop (2026-09-30)

The "Estimates" deliverable above landed with a UX decision the original text
left open: **a target/percent compress job might be unreachable, so it must
never spend a real encode before the user has any idea whether the number
they typed makes sense.** Concretely:

- `compress-video`'s `target-size`/`reduce-percent` modes, `compress-audio`'s
  `target-size`/`percent` modes, and `compress-pdf`'s `target-size`/`percent`
  modes now **stage** a dropped file instead of submitting on drop: the file
  is probed off the main thread (`src/lib/workers/probe.worker.ts`), a live
  estimate is shown next to the options, and an explicit "Convert" button —
  not the drop itself — starts the job. The estimate recomputes from the
  cached probe as the user edits the target/percent field; the file is never
  re-probed for that.
- Every other mode of those same three tools — best quality, custom quality,
  and PDF's recommended/lossless/strong — is **unaffected**: it still submits
  immediately on drop, exactly as before this addendum. Two reasons: there's
  no target to show an estimate against, and (per the "no
  decode/encode/zip on the main thread" invariant) a submit-on-drop mode
  gives the estimate nowhere to pause and be seen even if one were computed.
- The estimate is never claimed as the exact result. Video/audio reuse the
  same planner functions (`video-planner.ts`, `audio-target.ts`) the real
  encode calls, so the *reachability* and *resolution/bitrate choice* always
  agree — only a real encode's measured byte count (VBR variance,
  measure-and-retry passes) can differ from the shown target figure. PDF's
  estimate is explicitly a rule of thumb (see `pdf-estimate.ts`'s own doc
  comment): there's no closed form for how much a given image shrinks at a
  given DPI/quality without actually re-encoding it.

See `src/lib/estimate/` for the estimate functions and
`shouldStageForEstimate` (`src/lib/estimate/index.ts`) for the exact mode
list per tool, and `ToolRunner`'s own doc comments in
`src/components/tool-runner.tsx` for how staging plugs into the existing
drop-to-submit flow.

## Addendum: Compress PDF defaults to "Recommended" (2026-09-30)

The UX audit found that Compress PDF's default (`lossless`) handed back the
original for a photo PDF: "Already about as small as it gets." Lossless only
restructures the file, so any PDF whose weight is images barely changes, and
images are the reason most people open the tool. The default is now
`recommended`, which re-encodes images at a 150 dpi ceiling and mozjpeg
quality 0.65. `lossless` stays as an option, and `balanced` is gone: it was
the same idea as `recommended` with a milder quality (0.75), and one mode
beats two. The engine still accepts a saved `balanced` value and treats it as
`recommended`. Options are not persisted anywhere (no localStorage or URL
state), so nothing else needed migrating. Never-larger still applies.

**Root cause of `balanced` doing nothing.** `e2e/fixtures/photos.pdf` is one
2000x1500 JPEG on a 2000x1500 pt page, so the image is already only 72 dpi
effective. The 150 dpi ceiling never downsamples it, which left only the
quality drop, and re-encoding at quality 0.75 wasn't smaller than the source
JPEG (per-image guard in `compressImageStream` kept the original, then
`neverLarger` kept the whole file). The target ladder only shrank it because
its lower rungs (0.65 and below, and 96/72 dpi) go further. Measured on the
fixture (1,247,946 bytes): lossless 1,247,946; old balanced 1,247,946;
recommended 1,081,421 (87%); strong 787,163 (63%); target 0.6 MB 570,325.

The same finding drove a fix to the estimate (audit B8): the PDF estimator
assumed the strongest rung keeps 12% of image bytes, which is true for a
300 dpi scan and wrong for an image with nothing to downsample (45% here). It
now assumes 45% and only says "looks reachable" when the likely floor is at
least 20% under the target; closer than that it says the result might land a
little over.


## Addendum: compress-pdf failed on real files and barely shrank others (2026-10-07)

The owner reported two things on v0.7.0: a real PDF failed with "expected o6
but got oy instance", and a 69 MB PDF in Recommended mode only went to 67 MB.
We had no copy of either file, so we built a synthetic corpus (browser tests,
`compress-corpus.testutil.ts`) with the object shapes real exporters write and
read pdf-lib's dist code for the mechanism.

**Root cause of the error.** `dict.lookupMaybe(key, PDFName)` throws
`UnexpectedObjectTypeError` when the entry exists but is another type
(`PDFContext.lookupMaybe`: the type check runs whenever `types` is
non-empty). `decodeImageStream` called it for `/ColorSpace` on every
FlateDecode image, but `/ColorSpace` is often an array (`[/ICCBased 12 0 R]`,
`[/Indexed ...]`). "o6" and "oy" are the minified `PDFName` and `PDFArray`.
It threw before any try/catch, so one image failed the whole document. The
corpus reproduced it with an Indexed image; an ICC image with a plain
`/Filter` would hit the same line. The page scan had the same risk (typed
lookups on `/Contents` entries). All of it now reads through an untyped
lookup (`look()`), which never throws, and checks `instanceof` itself.

**Why Recommended did almost nothing on other files.** The image gate was
narrow, and everything outside it was left alone without saying so:

- A JPEG with `/Filter [/DCTDecode]` (an array) was skipped, because the code
  required a bare name. Same for array `/DecodeParms`.
- A Flate image with an ICC or other array colour space was skipped.
- Images with an `/SMask` were skipped, and the SMask image itself was
  re-encoded as an RGB JPEG (it must stay DeviceGray).
- Placement ignored Form XObjects, so an image two forms deep fell back to the
  page size, which under-estimates its DPI whenever it is drawn smaller than
  the page. Annotation appearance streams were not scanned either.
- The structural prune only ran in Lossless and target modes.

**New behaviour.**

- Per-image planning from the dictionary alone (`planImage`): JPEG or 8-bit
  gray/RGB samples under any chain of sample filters, colour space as a name,
  `[/ICCBased]` or a ref. Skipped, never fatal: JBIG2, CCITT, JPX, CMYK,
  Indexed, Lab, Separation, 16-bit, `/Decode`, colour-key `/Mask`, `/Matte`
  soft masks, mask images, images under 8 KB, over 60 megapixels.
- An image with an `/SMask` has its colour data re-encoded and the mask kept
  as is. Gray stays gray (a grayscale JPEG). The original `/ColorSpace` object
  is left untouched. JPEG decode ignores EXIF orientation and embedded colour
  conversion, as a PDF viewer does.
- A re-encode is kept only when it saves at least 10% of that image.
- Each image is processed in its own try/catch: an image that fails stays as
  it was. If the whole compress fails, the user sees "Couldn't compress this
  PDF. It may be damaged or use a format we don't support yet." and never a
  raw pdf-lib message (`compressFailure`). Encrypted files and aborts keep
  their own messages.
- Placement now follows `Do` into Form XObjects (CTM composed with each
  form's `/Matrix`, a cycle guard per path, a visit budget) and into
  annotation `/AP /N` streams (scaled `/BBox` to `/Rect`). Images are listed
  by object, so each is processed once at its largest placement, however many
  pages or forms use it.
- The structural prune now runs in Recommended and Strong too.
- The probe (and the target-size "non-image bytes" split) counts only images
  the run can actually re-encode, so skipped images no longer make an
  estimate look more hopeful than the run can deliver. The strongest-rung
  retention constant (0.45) is unchanged: it is still the pessimistic
  72-dpi case.

**Presets unchanged.** Recommended stays 150 dpi at mozjpeg quality 0.65, and
Strong 96 dpi at 0.5. That already matches the usual tools: Ghostscript
`/ebook` is 150 dpi at QFactor 0.76, and Adobe's and iLovePDF's medium
settings sit around 150 dpi and medium-high JPEG quality; mozjpeg's trellis
quantisation makes 65 look like a stock libjpeg ~72. The bug was coverage,
not the numbers.

**Measured** on the synthetic corpus (KB, Chromium; `lossless` is the
structural pass):

| File | Original | Lossless | Recommended before | Recommended now | Strong now |
| --- | --- | --- | --- | --- | --- |
| scan-rgb (300 dpi Flate) | 7950 | 7950 | 59 | 59 | 28 |
| scan-gray (300 dpi Flate) | 2581 | 2581 | 59 | 59 | 28 |
| jpeg-icc (ICC ref, array Filter/DecodeParms) | 755 | 755 | 755 | 56 | 19 |
| flate-icc (ICC array, array Filter) | 3735 | 3735 | 3735 | 65 | 24 |
| forms-nested (image 2 forms deep, small on a big page) | 756 | 756 | 135 | 30 | 11 |
| forms-cycle | 3722 | 3722 | 65 | 65 | 24 |
| smask | 4898 | 4898 | 3789 | 1238 | 1197 |
| indexed | 1029 | 1029 | threw | 1029 | 1029 |
| cmyk | 3593 | 3593 | 3593 | 3593 | 3593 |
| unsupported-codecs (JBIG2, CCITT, JPX) | 177 | 177 | 177 | 177 | 177 |
| shared-image (12 pages) | 758 | 758 | 59 | 59 | 21 |
| annotation (small on a big page) | 3726 | 3726 | 95 | 27 | 11 |
| odd-dicts | 6787 | 6787 | threw | 3075 | 3062 |

The synthetic pixels compress far better than a real photo, so read the
ratios as "touched or not", not as promised savings. The forms and annotation
rows put a small picture on a big page on purpose: the old page-size fallback
overestimated its size and kept 4x more pixels than needed. The corpus tests
check the output image dimensions for that.

**Not done.** Indexed, CMYK and the bilevel codecs are still left alone, and
the SMask image itself is kept lossless. Files whose weight is mostly those
will still barely shrink, and the result note says the original came back.

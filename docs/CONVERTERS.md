# Converters

Every conversion Localvert supports. **Add a row when you add a tool** — this
table is the support matrix people check before deciding the project is useful
to them.

Source of truth is `src/tools/**`; this table is the human-readable view of it.
If they disagree, the registry is right and this file is stale.

Columns: **Slug** is the URL (`/tools/<slug>`). **Engine** is the preferred
candidate — the router may pick a fallback at runtime, see
[ARCHITECTURE](ARCHITECTURE.md#the-router-picks-the-engine-at-runtime).
**Batch** means multiple files at once, output as a streaming ZIP.

## Image

HEIC and camera RAW (via `libraw`) are covered by real-file engine tests —
`src/lib/engines/heic/adapter.browser.test.ts` and
`src/lib/engines/libraw/adapter.browser.test.ts` decode synthetic, license-
clean `.heic`/`.dng` fixtures (see each engine's `fixtures/README.md` for
provenance) and assert plausible pixel output, not just pipeline resolution.
Neither is in the e2e matrix yet — that coverage is at the engine adapter
level, not through the full UI.

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `heic-to-jpg` | HEIC | JPEG | heic → jsquash-jpeg | Yes | Primary image only (no Live Photo video, no burst frames); strips EXIF (incl. GPS) |
| `heic-to-png` | HEIC | PNG | heic → jsquash-png | Yes | Primary image only (no Live Photo video, no burst frames); strips EXIF (incl. GPS) |
| `jpg-to-png` | JPEG | PNG | canvas | Yes | Lossless re-encode; strips EXIF (incl. GPS) |
| `jpg-to-webp` | JPEG | WebP | jsquash-jpeg + jsquash-webp | Yes | Quality + lossless; strips EXIF (incl. GPS) |
| `jpg-to-avif` | JPEG | AVIF | jsquash-jpeg + jsquash-avif | Yes | Quality + speed; strips EXIF (incl. GPS) |
| `jpg-to-jxl` | JPEG | JPEG XL | jsquash-jpeg + jsquash-jxl | Yes | Quality + effort + lossless; strips EXIF (incl. GPS) |
| `png-to-jpg` | PNG | JPEG | jsquash-png + jsquash-jpeg | Yes | Quality + background fill for transparency; strips metadata |
| `png-to-webp` | PNG | WebP | jsquash-png + jsquash-webp | Yes | Quality + lossless; transparency preserved |
| `png-to-avif` | PNG | AVIF | jsquash-png + jsquash-avif | Yes | Quality + speed; transparency preserved |
| `png-to-jxl` | PNG | JPEG XL | jsquash-png + jsquash-jxl | Yes | Quality + effort + lossless; transparency preserved |
| `webp-to-jpg` | WebP | JPEG | jsquash-webp / jsquash-jpeg | Yes | Quality + background fill; strips EXIF (incl. GPS) |
| `webp-to-png` | WebP | PNG | jsquash-webp / jsquash-png | Yes | Lossless re-encode; strips EXIF (incl. GPS) |
| `avif-to-jpg` | AVIF | JPEG | jsquash-avif / jsquash-jpeg | Yes | Quality + background fill; strips EXIF (incl. GPS) |
| `avif-to-png` | AVIF | PNG | jsquash-avif / jsquash-png | Yes | Lossless re-encode; strips EXIF (incl. GPS) |
| `jxl-to-jpg` | JPEG XL | JPEG | jsquash-jxl / jsquash-jpeg | Yes | Quality + background fill; strips EXIF (incl. GPS) |
| `jxl-to-png` | JPEG XL | PNG | jsquash-jxl / jsquash-png | Yes | Lossless re-encode; strips EXIF (incl. GPS) |
| `psd-to-jpg` | PSD | JPEG | psd → jsquash-jpeg | Yes | Flattened composite (8-bit RGB only); fills transparent areas with the chosen background color |
| `psd-to-png` | PSD | PNG | psd → jsquash-png | Yes | Flattened composite (8-bit RGB only) |
| `svg-to-jpg` | SVG | JPEG | resvg → jsquash-jpeg | Yes | Text needs an embedded font to render; fills transparent areas with the chosen background color |
| `svg-to-png` | SVG | PNG | resvg → jsquash-png | Yes | Text needs an embedded font to render |
| `tiff-to-jpg` | TIFF | JPEG | utif → jsquash-jpeg | Yes | First page only; strips EXIF (incl. GPS) |
| `tiff-to-png` | TIFF | PNG | utif → jsquash-png | Yes | First page only; strips EXIF (incl. GPS) |
| `png-to-svg` | PNG | SVG | jsquash-png → tracer | Yes | Traces color-region outlines, not a pixel re-encode; colours/detail/max trace size are configurable; large images traced at up to 1600 px on the long side |
| `jpg-to-svg` | JPEG | SVG | jsquash-jpeg → tracer | Yes | Traces color-region outlines, not a pixel re-encode; colours/detail/max trace size are configurable; large images traced at up to 1600 px on the long side |
| `webp-to-svg` | WebP | SVG | jsquash-webp → tracer | Yes | Traces color-region outlines, not a pixel re-encode; colours/detail/max trace size are configurable; large images traced at up to 1600 px on the long side |
| `strip-exif` | JPEG/PNG/WebP | same format | exif | Yes | Byte-level metadata strip, no re-encode; drops GPS/EXIF/XMP/IPTC, keeps ICC colour profile; optionally rebuilds a minimal orientation-only EXIF |
| `raw-to-jpg` | Camera RAW (CR2, NEF, ARW, DNG, RAF, ORF, RW2, …) | JPEG | libraw → jsquash-jpeg | Yes | Camera white balance, sRGB, 8-bit; optional half-size decode; strips EXIF (incl. GPS) |
| `raw-to-png` | Camera RAW (CR2, NEF, ARW, DNG, RAF, ORF, RW2, …) | PNG | libraw → jsquash-png | Yes | Camera white balance, sRGB, 8-bit; optional half-size decode; strips EXIF (incl. GPS) |
| `image-to-text` | JPEG/PNG/WebP/BMP | Text (OCR) | tesseract | Yes | English only today (`language` select); OCR accuracy depends on the source image |
| `gif-to-png` | GIF | PNG | canvas | Yes | First frame only (no animation) |
| `gif-to-jpg` | GIF | JPEG | canvas | Yes | First frame only (no animation); background fill for transparency |
| `bmp-to-png` | BMP | PNG | canvas | Yes | — |
| `bmp-to-jpg` | BMP | JPEG | canvas | Yes | Background fill for transparency |
| `ico-to-png` | ICO | PNG | canvas | Yes | Decodes the largest embedded size; PNG-compressed (Vista+) or legacy DIB entries |
| `png-to-bmp` | PNG | BMP | canvas | Yes | 24-bit if fully opaque, else 32-bit with alpha; pure-TS encoder |
| `jpg-to-bmp` | JPEG | BMP | canvas | Yes | Always 24-bit (no alpha in JPEG); pure-TS encoder |
| `png-to-ico` | PNG | ICO | canvas | Yes | `sizes` preset (favicon 16/32/48, app +64/128/256, single 256); non-square source fit inside each square with transparent padding |
| `jpg-to-ico` | JPEG | ICO | canvas | Yes | Same `sizes` preset as `png-to-ico` |
| `png-to-gif` | PNG | GIF | canvas | Yes | Single frame (no animation); 256-color palette, 1-bit transparency, via gifenc |
| `jpg-to-gif` | JPEG | GIF | canvas | Yes | Single frame (no animation); 256-color palette, via gifenc |

## Image operations

Same-format tools — compress, resize, rotate — rather than a format
conversion. **Engine** lists every step's preferred candidate in pipeline
order (decode [+ transform] [+ encode]).

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `compress-jpg` | JPEG | JPEG | jsquash-jpeg, exif | Yes | Mode: lossless (metadata strip), high quality (default, SSIM-searched), smallest file (SSIM-searched, looser), custom quality, target size (KB), or reduce by percentage. Target size/percent fall back to a resize if quality alone can't reach the budget. Never bigger than the input |
| `compress-webp` | WebP | WebP | jsquash-webp, exif | Yes | Mode: lossless (metadata strip), high quality (default, SSIM-searched), smallest file (SSIM-searched, looser), custom quality, target size (KB), or reduce by percentage. Target size/percent fall back to a resize if quality alone can't reach the budget. Never bigger than the input |
| `compress-png` | PNG | PNG | jsquash-png | Yes | Mode: lossless (oxipng, default — reduces to an exact palette automatically when the source has <=256 colours), smaller (image-q palette reduction + oxipng, optional dither), target size (KB), or reduce by percentage (steps the palette down 256->16, or reports it can't reach the target on a photo-like PNG). Never bigger than the input |
| `resize-image-jpg` | JPEG | JPEG | jsquash-jpeg, jsquash-resize | Yes | Width/height, fit, allow upscale |
| `resize-image-png` | PNG | PNG | jsquash-png, jsquash-resize | Yes | Width/height, fit, allow upscale |
| `resize-image-webp` | WebP | WebP | jsquash-webp, jsquash-resize | Yes | Width/height, fit, allow upscale |
| `rotate-jpg` | JPEG | JPEG | jsquash-jpeg, canvas | Yes | 90/180/270° clockwise |
| `rotate-png` | PNG | PNG | jsquash-png, canvas | Yes | 90/180/270° clockwise |
| `rotate-webp` | WebP | WebP | jsquash-webp, canvas | Yes | 90/180/270° clockwise |
| `crop-jpg` | JPEG | JPEG | jsquash-jpeg, canvas | No | Interactive crop box, free or fixed aspect |
| `crop-png` | PNG | PNG | jsquash-png, canvas | No | Interactive crop box, free or fixed aspect |
| `crop-webp` | WebP | WebP | jsquash-webp, canvas | No | Interactive crop box, free or fixed aspect |

Crop is out of scope for this slice — it needs an interactive crop UI.

## PDF

`merge-pdf`, `split-pdf`, `images-to-pdf` and its single-format siblings
`jpg-to-pdf`/`png-to-pdf` are ADR-0008 multi-file tools, not one-to-one
conversions — **Batch** (repeat per dropped file) doesn't apply to any of
them, so that column reads their own **Arity** instead.

| Slug | From | To | Engine | Arity | Notes |
|---|---|---|---|---|---|
| `merge-pdf` | PDF | PDF | pdf-lib | many-to-one | Combines every dropped PDF into one, in the order arranged via drag/keyboard reorder |
| `split-pdf` | PDF | PDF | pdf-lib | one-to-many | One file per page, or one per `;`-separated page range |
| `rotate-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | Rotates selected pages 90/180/270°, added to any existing rotation |
| `delete-pdf-pages` | PDF | PDF | pdf-lib | one-to-one (batch) | Removes the given pages, keeps the rest in order |
| `extract-pdf-pages` | PDF | PDF | pdf-lib | one-to-one (batch) | Keeps only the given pages, in the order given |
| `reorder-pdf-pages` | PDF | PDF | pdf-lib | one-to-one (batch) | Rearranges pages per `order` (e.g. "3, 1, 2, 4-6"); ranges may run backwards, repeating a page duplicates it, blank = unchanged |
| `images-to-pdf` | JPEG/PNG | PDF | pdf-lib | many-to-one | One image per page, in the order arranged via drag/keyboard reorder; page size fit/A4/letter, orientation, margin |
| `jpg-to-pdf` | JPEG | PDF | pdf-lib | many-to-one | Single-format sibling of `images-to-pdf`, same options |
| `png-to-pdf` | PNG | PDF | pdf-lib | many-to-one | Single-format sibling of `images-to-pdf`, same options |
| `watermark-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | Stamps text across every selected page; diagonal/horizontal, opacity/size/color/position; rejects non-WinAnsi text with a clear message rather than silently dropping characters |
| `add-page-numbers` | PDF | PDF | pdf-lib | one-to-one (batch) | Draws a page number label per selected page; six corner/edge positions, 4 formats, `startAt`; numbering counts every page even when only some are labeled |
| `protect-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | Adds a password, AES-256; printing/copying permissions |
| `unlock-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | Removes a password you already have |
| `compress-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | `mode`: lossless (default, object streams + unreferenced-object pruning, no image recompression), balanced/strong (mozjpeg re-encode, downsampled by effective DPI — 150 dpi/q0.75 and 96 dpi/q0.5), target size (MB) or reduce-by-% (walks a DPI/quality ladder, stops at the first result that fits); result note says what was reached; never bigger than the input |
| `flatten-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | Bakes form field values into the page, removes the fields; no-op on a PDF with no form |
| `sanitize-pdf` | PDF | PDF | pdf-lib | one-to-one (batch) | Strips metadata/JavaScript/attachments (default on), web links (default off) |
| `pdf-to-jpg` | PDF | JPEG | pdfjs | one-to-many | One JPG per selected page (`pages`, `dpi`, `quality`); white background |
| `pdf-to-png` | PDF | PNG | pdfjs | one-to-many | One PNG per selected page (`pages`, `dpi`); page transparency preserved |
| `pdf-to-text` | PDF | Text | pdfjs | one-to-one (batch) | Extracts embedded text into a `.txt` file (`pages`, `pageMarkers` heading each page); a scanned PDF with no text layer needs `pdf-to-searchable-pdf`'s OCR first |
| `pdf-to-word` | PDF | Word (.docx) | pdfjs (`extractLayout`) -> docx (`transcode`) | one-to-one (batch) | Reconstructs paragraphs/headings (font-size ratio) into an editable `.docx`; `pageBreaks` (default on). Layout approximate: reading order only, text-only (no images yet, no column detection); scanned PDFs need `pdf-to-searchable-pdf`'s OCR first. See docs/adr/0014-pdf-to-word.md |
| `image-to-searchable-pdf` | JPEG/PNG/WebP/BMP | PDF | tesseract | one-to-one (batch) | Adds an invisible OCR text layer over the original page image; English only today (`language` select). Single-page input only — see `pdf-to-searchable-pdf` for multi-page |
| `pdf-to-searchable-pdf` | PDF | PDF | tesseract (composite `ocrPdf` op, driving `pdfjs` render and `pdf-lib` merge internally) | one-to-one (batch) | Renders each page, OCRs it, and merges the searchable pages back into one PDF, in order; English only today (`language` select); capped at 200 pages per job |
| `pdf-editor` | PDF | PDF | pdfium (session) | n/a — `kind: "app"` | Opens one PDF at a time; highlight, underline, strikethrough, freehand ink, rectangle, ellipse, line/arrow, free text and image-stamp annotations; undo/redo (Ctrl+Z / Ctrl+Shift+Z); exports `<name>-edited.pdf`. One page at a time (prev/next) — not the virtualised multi-page scroll + thumbnail rail ADR-0009 describes; see docs/ROADMAP.md's E1 note |

## Video

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `mp4-to-webm` | MP4, MOV | WebM | mediabunny | Yes | Re-encodes to VP9 (falls back to VP8) + Opus, whichever this browser's WebCodecs can encode; large outputs stream through OPFS rather than memory — see ADR-0010 |
| `video-to-gif` | MP4, MOV, WebM | GIF | mediabunny (`toGif` op, gifenc) | Yes | Trims to `start`/`duration` (≤30s), samples at `fps` (≤30), scales to `width` (≤800px, even dims), quantizes to `colors` per frame — gifenc (MIT), not ffmpeg, per ADR-0002's GIF mitigation |
| `webm-to-mp4` | WebM | MP4 | mediabunny | Yes | Re-encodes VP9-or-VP8/Opus to AVC/AAC; `quality` select (Low/Medium/High) |
| `mov-to-mp4` | MOV | MP4 | mediabunny | Yes | Usually a fast remux (both ISOBMFF, h264/aac fits either container); falls back to a real transcode otherwise. `quality` select |
| `mkv-to-mp4` | MKV | MP4 | mediabunny | Yes | Re-encodes VP9-or-VP8/Opus to AVC/AAC; `quality` select. MKV sniffing relies on `refineFormat`'s extension-based upgrade from WebM (shared EBML magic) |
| `avi-to-mp4` | AVI | MP4 | ffmpeg | Yes | Re-encodes to libx264/AAC (`-crf 23 -preset veryfast`); AVI's usual codecs aren't WebCodecs-decodable, so this is the first tool routed to ffmpeg (GPL-2.0-or-later, r2-hosted, ~31 MB, ADR-0002) rather than the permissive mediabunny path |
| `wmv-to-mp4` | WMV | MP4 | ffmpeg | Yes | Same ffmpeg route as `avi-to-mp4` — WMV's codec isn't WebCodecs-decodable |
| `flv-to-mp4` | FLV | MP4 | ffmpeg | Yes | Same ffmpeg route as `avi-to-mp4` — FLV's codec isn't WebCodecs-decodable |
| `mp4-to-mov` | MP4 | MOV | mediabunny | Yes | Usually a fast remux; falls back to a real transcode otherwise. `quality` select |
| `mov-to-webm` | MOV | WebM | mediabunny | Yes | Re-encodes to VP9-or-VP8 + Opus; `quality` select |
| `trim-video` | MP4, MOV, WebM, MKV | same container | mediabunny | Yes | Cuts to a start/end time in seconds; `end` must be greater than `start` (validated in the engine, not the option schema — see `video.ts`'s `validateTrim`) |
| `mute-video` | MP4, MOV, WebM, MKV | same container | mediabunny | Yes | Discards the audio track; video copied without re-encode when the container/codec pair allows it |
| `resize-video` | MP4, MOV, WebM, MKV | same container | mediabunny | Yes | `1080p`/`720p`/`480p` presets (height-based, width from aspect ratio) or a custom width/height + fit |
| `compress-video` | MP4, MOV, WebM, MKV | same container | mediabunny | Yes | Best quality (default, bits-per-pixel ceiling), custom quality (Low/Medium/High), target size (MB), or reduce by % — plus an optional max-resolution cap (ADR-0017) |
| `rotate-video` | MP4, MOV, WebM, MKV | same container | mediabunny | Yes | Rotates 90/180/270 degrees clockwise |

## Audio

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `compress-audio` | MP3, M4A, Ogg, Opus | same format | mediabunny | Yes | Lossy: best quality (default, a bitrate below the source's own), target size (MB), reduce by %, or a custom bitrate (64/96/128 kbps); target/percent modes snap to a rate the codec accepts and downmix to mono below the stereo floor. Result note says what was reached. Never bigger than the input |
| `extract-audio` | MP4, MOV, WebM | MP3 (default), M4A, WAV, Ogg or Opus | mediabunny | Yes | Discards the video track; output format selectable; bitrate/sample rate/channels configurable for lossy targets |
| `wav-to-mp3` | WAV | MP3 | mediabunny | Yes | Bitrate/sample rate/channels; MP3 uses the LAME wasm encoder (`@mediabunny/mp3-encoder`), no browser encodes MP3 natively |
| `mp3-to-wav` | MP3 | WAV | mediabunny | Yes | Sample rate/channels only — PCM has no bitrate knob |
| `flac-to-mp3` | FLAC | MP3 | mediabunny | Yes | Bitrate/sample rate/channels |
| `m4a-to-mp3` | M4A | MP3 | mediabunny | Yes | Bitrate/sample rate/channels |
| `ogg-to-mp3` | Ogg Vorbis (or Opus) | MP3 | mediabunny | Yes | Bitrate/sample rate/channels |
| `mp3-to-ogg` | MP3 | Ogg | mediabunny | Yes | Encodes Opus (falls back to Vorbis); bitrate/sample rate/channels |
| `wav-to-flac` | WAV | FLAC | mediabunny | Yes | Sample rate/channels only; FLAC uses the libFLAC wasm encoder (`@mediabunny/flac-encoder`), no browser encodes FLAC natively |
| `mp3-to-m4a` | MP3 | M4A | mediabunny | Yes | Encodes AAC; bitrate/sample rate/channels; fails with a clear error if this browser can't encode AAC |
| `mp4-to-mp3` | MP4 | MP3 | mediabunny | Yes | Discards the video track; bitrate/sample rate/channels |
| `mov-to-mp3` | MOV | MP3 | mediabunny | Yes | Discards the video track; bitrate/sample rate/channels |
| `webm-to-mp3` | WebM | MP3 | mediabunny | Yes | Discards the video track; bitrate/sample rate/channels |
| `aac-to-mp3` | AAC (raw ADTS) | MP3 | mediabunny | Yes | Bitrate/sample rate/channels |
| `opus-to-mp3` | Opus (Ogg container) | MP3 | mediabunny | Yes | Bitrate/sample rate/channels |
| `m4a-to-wav` | M4A | WAV | mediabunny | Yes | Sample rate/channels only — PCM has no bitrate knob |
| `flac-to-wav` | FLAC | WAV | mediabunny | Yes | Sample rate/channels only — PCM has no bitrate knob |
| `wma-to-mp3` | WMA | MP3 | ffmpeg | Yes | Consent-gated GPL engine (ADR-0002), same route as `wmv-to-mp4`; decodes wmav1/wmav2, encodes with libmp3lame |

## Document

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `markdown-to-pdf` | Markdown | PDF | typst | Yes | `pageSize` (a4/letter) and `fontSize` (10/11/12pt) options; renders via a generated Typst document + the vendored `cmarker` package (ADR-0011). Images referenced by the markdown render as their alt text only — never fetched or looked up. |
| `word-to-pdf` | Word (DOCX, DOC), OpenDocument Text, RTF | PDF | libreoffice | Yes | Needs a desktop browser (≥4 GB memory) and a one-time ~74 MB download, consent-gated (ADR-0012). No CJK fonts in this build. |
| `excel-to-pdf` | Excel (XLSX, XLS), OpenDocument Spreadsheet | PDF | libreoffice | Yes | Same engine/limits as `word-to-pdf` (ADR-0012). |
| `powerpoint-to-pdf` | PowerPoint (PPTX, PPT), OpenDocument Presentation | PDF | libreoffice | Yes | Same engine/limits as `word-to-pdf` (ADR-0012). |
| `txt-to-pdf` | Text | PDF | libreoffice | Yes | Same engine/limits as `word-to-pdf` (ADR-0012 addendum), via LibreOffice Writer's "Text" import filter. |
| `html-to-pdf` | HTML | PDF | libreoffice | Yes | Same engine/limits as `word-to-pdf` (ADR-0012 addendum). External images/stylesheets never load (`connect-src 'self'`) — only what's embedded in the file renders. |
| `epub-to-pdf` | EPUB | PDF | epub, libreoffice | Yes | Two-step pipeline: the `epub` engine (pure JS, `fflate`) unzips the epub and concatenates its spine's XHTML chapters into one HTML document (images inlined as `data:` URIs or dropped with a note), then `libreoffice`'s HTML import renders it (ADR-0012 addendum). Layout is approximate — EPUB's own reflowable styling isn't preserved. PDF→Word/EPUB import is not supported by this LibreOffice build — see the same addendum. |

## Archive

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | Phase 1 (compression) |

## Data

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `json-to-yaml` | JSON | YAML | data | Yes | Preserves key order; indent fixed at 2 |
| `yaml-to-json` | YAML | JSON | data | Yes | — |
| `json-to-xlsx` | JSON | XLSX | data | Yes | JSON must be an array of objects; nested values are JSON-stringified into their cell; bold header row, single sheet named "Sheet1" |
| `xlsx-to-json` | XLSX | JSON | data | Yes | `sheet` option (1-based, default 1) picks which sheet to read |
| `csv-to-json` | CSV | JSON | data | Yes | `delimiter` (auto/comma/semicolon/tab) and "detect numbers and booleans" options |
| `json-to-csv` | JSON | CSV | data | Yes | JSON must be an array of flat objects; nested values are JSON-stringified into their cell |
| `csv-to-xlsx` | CSV | XLSX | data | Yes | Same csv options as `csv-to-json`; bold header row, single sheet named "Sheet1" |
| `xlsx-to-csv` | XLSX | CSV | data | Yes | `sheet` option (1-based, default 1) picks which sheet to read |

`csv`/`json`/`yaml` are `text` formats in the registry (no magic bytes,
identified by extension with a NUL-byte guard) — see `docs/ENGINES.md`'s
note on the `data` engine for the mechanism.

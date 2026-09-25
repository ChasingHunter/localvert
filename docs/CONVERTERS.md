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

Known gap: no HEIC fixture. HEIC's own license terms make it impractical to
check a real `.heic` file into the repo, so `heic-to-jpg`/`heic-to-png` have
no e2e coverage — they're covered by registry tests (pipeline resolution,
options, defaults) only, not an actual decode through `heic-to`.

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
| `strip-exif` | JPEG/PNG/WebP | same format | exif | Yes | Byte-level metadata strip, no re-encode; drops GPS/EXIF/XMP/IPTC, keeps ICC colour profile; optionally rebuilds a minimal orientation-only EXIF |
| `raw-to-jpg` | Camera RAW (CR2, NEF, ARW, DNG, RAF, ORF, RW2, …) | JPEG | libraw → jsquash-jpeg | Yes | Camera white balance, sRGB, 8-bit; optional half-size decode; strips EXIF (incl. GPS) |
| `raw-to-png` | Camera RAW (CR2, NEF, ARW, DNG, RAF, ORF, RW2, …) | PNG | libraw → jsquash-png | Yes | Camera white balance, sRGB, 8-bit; optional half-size decode; strips EXIF (incl. GPS) |

## Image operations

Same-format tools — compress, resize, rotate — rather than a format
conversion. **Engine** lists every step's preferred candidate in pipeline
order (decode [+ transform] [+ encode]).

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `compress-jpg` | JPEG | JPEG | jsquash-jpeg | Yes | Target size (KB) or quality |
| `compress-webp` | WebP | WebP | jsquash-webp | Yes | Target size (KB) or quality |
| `resize-image-jpg` | JPEG | JPEG | jsquash-jpeg, jsquash-resize | Yes | Width/height, fit, allow upscale |
| `resize-image-png` | PNG | PNG | jsquash-png, jsquash-resize | Yes | Width/height, fit, allow upscale |
| `resize-image-webp` | WebP | WebP | jsquash-webp, jsquash-resize | Yes | Width/height, fit, allow upscale |
| `rotate-jpg` | JPEG | JPEG | jsquash-jpeg, canvas | Yes | 90/180/270° clockwise |
| `rotate-png` | PNG | PNG | jsquash-png, canvas | Yes | 90/180/270° clockwise |
| `rotate-webp` | WebP | WebP | jsquash-webp, canvas | Yes | 90/180/270° clockwise |

Crop is out of scope for this slice — it needs an interactive crop UI.

## PDF

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | Phase 2 |

## Video

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | Phase 3 |

## Audio

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | Phase 3 |

## Document

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | Phase 4 |

## Archive

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | Phase 1 (compression) |

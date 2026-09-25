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

| Slug | From | To | Engine | Batch | Notes |
|---|---|---|---|---|---|
| `jpg-to-png` | JPEG | PNG | canvas | Yes | Lossless re-encode; strips EXIF (incl. GPS) |
| `jpg-to-webp` | JPEG | WebP | jsquash-jpeg + jsquash-webp | Yes | Quality + lossless; strips EXIF (incl. GPS) |
| `jpg-to-avif` | JPEG | AVIF | jsquash-jpeg + jsquash-avif | Yes | Quality + speed; strips EXIF (incl. GPS) |
| `jpg-to-jxl` | JPEG | JPEG XL | jsquash-jpeg + jsquash-jxl | Yes | Quality + effort + lossless; strips EXIF (incl. GPS) |
| `png-to-jpg` | PNG | JPEG | jsquash-png + jsquash-jpeg | Yes | Quality + background fill for transparency; strips metadata |
| `png-to-webp` | PNG | WebP | jsquash-png + jsquash-webp | Yes | Quality + lossless; transparency preserved |
| `png-to-avif` | PNG | AVIF | jsquash-png + jsquash-avif | Yes | Quality + speed; transparency preserved |
| `png-to-jxl` | PNG | JPEG XL | jsquash-png + jsquash-jxl | Yes | Quality + effort + lossless; transparency preserved |
| `strip-exif` | JPEG/PNG/WebP | same format | exif | Yes | Byte-level metadata strip, no re-encode; drops GPS/EXIF/XMP/IPTC, keeps ICC colour profile; optionally rebuilds a minimal orientation-only EXIF |

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

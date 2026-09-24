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

# heic adapter fixtures

`adapter.browser.test.ts` looks for `sample.heic` here and gates its
real-decode assertions on whether it exists (`describe.skipIf`) — no
fixture, no failing CI, just a smaller test.

## sample.heic

Synthetic, generated for this repo — not a real photo, so there is no
licensing question. Built with a throwaway Python script (not committed)
using `pillow-heif`:

- 64x48 RGB image, four distinct coloured quadrants (red / green / blue /
  yellow) plus a diagonal gradient blend, so the encoder has real image
  structure rather than four flat rectangles.
- Saved via `pillow_heif`'s `Image.save(..., format="HEIF", quality=60)`.
- Verified before committing: round-trips through `pillow_heif.open_heif`
  back to the same 64x48 size, magic bytes are a valid `ftyp` box with the
  `heic` major brand, and the file is 573 bytes — well under the 60 KB
  budget.

`adapter.browser.test.ts`'s fixture-gated test checks the decoded raster is
exactly 64x48, fully opaque, and that each quadrant's centre pixel is
dominated by the expected channel (tolerant of the shift lossy HEVC
encoding introduces).

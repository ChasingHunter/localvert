# libraw adapter fixtures

`adapter.browser.test.ts` looks for `sample.dng` here and gates its real-decode
assertions on whether it exists (`describe.skipIf`) — no fixture, no failing
CI, just a smaller test.

## sample.dng

Synthetic, generated for this repo — not a real camera capture, so there is
no licensing question. Built with a throwaway Python script (not committed)
using `tifffile` + `numpy`:

- 64x48 uint16 RGGB Bayer mosaic sampled from the same four-quadrant +
  gradient synthetic scene as `../../heic/fixtures/sample.heic` (red / green
  / blue / yellow), so both fixtures' expected colours are easy to reason
  about together.
- Written as a `PhotometricInterpretation = 32803` (CFA) TIFF with the DNG
  tags LibRaw needs to recognise and demosaic it: `DNGVersion` (1.4.0.0),
  `UniqueCameraModel` ("Localvert Test"), `CFARepeatPatternDim` ([2,2]),
  `CFAPattern` (RGGB), `BlackLevel` (0), `WhiteLevel` (65535),
  `ColorMatrix1` (identity-ish 3x3 SRATIONAL), `AsShotNeutral` ([1,1,1]),
  16-bit/1-sample-per-pixel.
- Verified before committing with `rawpy` (LibRaw's own Python binding):
  `rawpy.imread(path).postprocess()` demosaics it to a 64x48x3 image whose
  quadrant colours match the source mosaic. File size: 6,608 bytes — well
  under the 200 KB budget.

`adapter.browser.test.ts`'s fixture-gated tests check the decoded raster is
~64x48 (±2px, for LibRaw's demosaic border handling), fully opaque, that the
red quadrant's centre pixel is red-dominant, and that `halfSize` decodes to
smaller dimensions than a full decode.

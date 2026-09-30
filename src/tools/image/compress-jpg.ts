import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013/0017: `lossless` is metadata-strip only (the `exif` engine's
 * byte-level `stripJpeg`, reused verbatim — no re-encode, pixels untouched)
 * since a JPEG's size lives almost entirely in its lossy pixel data, which a
 * metadata strip alone barely touches. `visually-lossless` ("High quality",
 * the actual default) and `strong` ("Smallest file") no longer use a fixed
 * quality number — both run a perceptual search (`searchBestQuality`,
 * SSIM-thresholded: 0.9999 for high quality, 0.999 for smaller) that picks
 * the smallest integer quality that still looks the same. `custom` (a
 * direct quality slider, shown only in this mode) is the one remaining
 * explicit, visibly-lossy choice. `target-size` and `percent` both resolve
 * to a byte budget and share the same search (percent = source size x
 * (1 - percent/100), then behaves exactly like target-size, per ADR-0017).
 * All six run through the single `jsquash-jpeg` `compress` op
 * (`runCompress`), which never returns a file bigger than the input.
 */
export default defineTool({
  slug: "compress-jpg",
  category: "image",
  categoryRank: 4,
  title: "Compress JPG",
  description:
    "Shrink a JPG. Keep high quality (the default), go smaller, set the quality yourself, aim for a size like under 200 KB, or cut it by a percentage. Never makes the file bigger.",

  accepts: ["jpg"],
  produces: "jpg",

  options: z.object({
    mode: z
      .enum([
        "lossless",
        "visually-lossless",
        "strong",
        "custom",
        "target-size",
        "percent",
      ])
      .meta({
        label: "Mode",
        control: "select",
        help: '"Lossless" only strips metadata; the other modes re-encode the image.',
        optionLabels: {
          lossless: "Lossless (strip metadata only)",
          "visually-lossless": "High quality (recommended)",
          strong: "Smallest file",
          custom: "Custom quality",
          "target-size": "Target file size",
          percent: "Reduce by percentage",
        },
      })
      .default("visually-lossless"),
    quality: z
      .number()
      .min(0.05)
      .max(1)
      .meta({
        label: "Quality",
        control: "slider",
        showWhen: { field: "mode", equals: "custom" },
      })
      .default(0.75),
    targetSizeKB: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .meta({
        label: "Target size",
        control: "number",
        unit: "KB",
        showWhen: { field: "mode", equals: "target-size" },
      })
      // A real default (not `.optional()`, unlike the old standalone
      // targetSizeKB field) rather than `required: true` — combining
      // `required` with `showWhen` would make `requiredOptionKeys` (which
      // has no notion of visibility) treat this as always-required, which
      // both `OptionsForm`'s and `ToolRunner`'s required-field gates would
      // then block on even in every OTHER mode, where this field isn't even
      // shown. No precedent in the registry combines the two for that
      // reason; see docs/adr/0013-compression-modes.md.
      .default(200),
    percent: z
      .number()
      .int()
      .min(10)
      .max(90)
      .meta({
        label: "Reduce by",
        control: "slider",
        unit: "%",
        showWhen: { field: "mode", equals: "percent" },
      })
      .default(50),
  }),
  defaults: {
    mode: "visually-lossless",
    quality: 0.75,
    targetSizeKB: 200,
    percent: 50,
  },

  pipeline: [
    {
      op: "compress",
      candidates: [{ engine: "jsquash-jpeg" }],
    },
  ],

  batch: true,
  actionLabel: "Compress",
});

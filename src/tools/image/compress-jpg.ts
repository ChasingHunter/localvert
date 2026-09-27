import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013: `lossless` is metadata-strip only (the `exif` engine's
 * byte-level `stripJpeg`, reused verbatim — no re-encode, pixels untouched)
 * since a JPEG's size lives almost entirely in its lossy pixel data, which a
 * metadata strip alone barely touches. `visually-lossless` is the actual
 * default: mozjpeg quality ~0.85, the commonly-cited threshold below which
 * compression artifacts start being visible on typical photos at normal
 * viewing distance — a real size win nobody has to second-guess. `strong`
 * (~0.6) and `custom` (a direct quality slider, shown only in this mode) are
 * explicit, visibly-lossy choices; `target-size` is the pre-existing
 * byte-budget behaviour, unchanged. All five run through the single
 * `jsquash-jpeg` `compress` op (`runCompress`), which never returns a file
 * bigger than the input.
 */
export default defineTool({
  slug: "compress-jpg",
  category: "image",
  title: "Compress JPG",
  description:
    "Shrink a JPG file — losslessly (metadata only), visually lossless " +
    "(the default), strong, a custom quality, or a target size (e.g. under " +
    "200 KB) — free, private, in your browser. Files never leave your " +
    "device. Never makes the file bigger.",

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
      ])
      .meta({
        label: "Mode",
        control: "select",
        help: '"Lossless" only strips metadata; the other modes re-encode the image.',
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
  }),
  defaults: { mode: "visually-lossless", quality: 0.75, targetSizeKB: 200 },

  pipeline: [
    {
      op: "compress",
      candidates: [{ engine: "jsquash-jpeg" }],
    },
  ],

  batch: true,
});

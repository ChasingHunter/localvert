import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Same mode set as `compress-jpg.ts` — see that file's doc comment for the
 * ADR-0013 reasoning behind visually-lossless-as-default. `lossless` here is
 * metadata-strip only too, and for the same underlying reason as jpg: WebP's
 * own *encoder*-level lossless mode re-encodes every pixel losslessly, which
 * on an already-lossy source (the common case — a photo saved as WebP)
 * produces a *bigger* file than the lossy original, not a smaller one. A
 * byte-level metadata strip (the `exif` engine's `stripWebp`) is the only
 * thing that's actually lossless *and* smaller-or-equal here.
 */
export default defineTool({
  slug: "compress-webp",
  category: "image",
  title: "Compress WebP",
  description:
    "Shrink a WebP file — losslessly (metadata only), visually lossless " +
    "(the default), strong, a custom quality, or a target size (e.g. under " +
    "200 KB) — free, private, in your browser. Files never leave your " +
    "device. Never makes the file bigger.",

  accepts: ["webp"],
  produces: "webp",

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
      // A real default, not `required: true` — see compress-jpg.ts's
      // identical field for why `required` + `showWhen` don't mix here.
      .default(200),
  }),
  defaults: { mode: "visually-lossless", quality: 0.75, targetSizeKB: 200 },

  pipeline: [
    {
      op: "compress",
      candidates: [{ engine: "jsquash-webp" }],
    },
  ],

  batch: true,
});

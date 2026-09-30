import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013/0017: `lossless` (default) never touches a pixel — oxipng repacks
 * the same PNG data more efficiently (including its own automatic colour-
 * type/palette reduction when the source has few enough distinct colours —
 * see `jsquash-png/adapter.ts`'s `encodeAndOptimize` doc comment) and
 * metadata is dropped as a side effect of the decode/encode round trip,
 * nothing more. `smaller` additionally reduces the image to at most 256
 * colours first (image-q palette quantisation, `dither` togglable), a real
 * size win oxipng alone can't get on photo-like PNGs. `target-size`/
 * `percent` step the palette down further (256 -> 16) to hit a byte budget,
 * stopping before a step would visibly ruin the image (SSIM < 0.998) — a
 * photo-like PNG that can't reach the target that way gets a note steering
 * to JPG/WebP instead. All four modes run through the `jsquash-png`
 * adapter's single `compress` op (see its `runCompress`), which never
 * returns a file bigger than the input.
 */
export default defineTool({
  slug: "compress-png",
  category: "image",
  title: "Compress PNG",
  description:
    "Shrink a PNG file losslessly, reduce it to a smaller colour palette, aim for a size like under 200 KB, or cut it by a percentage. Never makes the file bigger.",

  accepts: ["png"],
  produces: "png",

  options: z.object({
    mode: z
      .enum(["lossless", "smaller", "target-size", "percent"])
      .meta({
        label: "Mode",
        control: "select",
        help: '"Lossless" only repacks the file; the other modes reduce colours to shrink it further.',
        optionLabels: {
          lossless: "Lossless",
          smaller: "Smaller (reduce colours)",
          "target-size": "Target file size",
          percent: "Reduce by percentage",
        },
      })
      .default("lossless"),
    dither: z
      .boolean()
      .meta({
        label: "Dither",
        control: "switch",
        help: "Smooths banding from colour reduction, at a slightly larger file size.",
        showWhen: {
          field: "mode",
          equals: ["smaller", "target-size", "percent"],
        },
      })
      .default(true),
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
    mode: "lossless",
    dither: true,
    targetSizeKB: 200,
    percent: 50,
  },

  pipeline: [
    {
      op: "compress",
      candidates: [{ engine: "jsquash-png" }],
    },
  ],

  batch: true,
});

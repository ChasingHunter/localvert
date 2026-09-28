import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013: `lossless` (default) never touches a pixel — oxipng repacks the
 * same PNG data more efficiently and metadata is dropped as a side effect of
 * the decode/encode round trip, nothing more. `smaller` additionally reduces
 * the image to at most 256 colours first (image-q palette quantisation,
 * `dither` togglable), a real size win oxipng alone can't get on
 * photo-like PNGs — gated behind an explicit mode rather than folded into
 * the default, since it does change what the image looks like. Both modes
 * run through the `jsquash-png` adapter's single `compress` op (see its
 * `runCompress`), which never returns a file bigger than the input.
 */
export default defineTool({
  slug: "compress-png",
  category: "image",
  title: "Compress PNG",
  description:
    "Shrink a PNG file losslessly, or reduce it to a smaller colour palette for an even smaller file. Never makes the file bigger.",

  accepts: ["png"],
  produces: "png",

  options: z.object({
    mode: z
      .enum(["lossless", "smaller"])
      .meta({
        label: "Mode",
        control: "select",
        help: '"Lossless" only repacks the file; "Smaller" reduces colours too.',
        optionLabels: {
          lossless: "Lossless",
          smaller: "Smaller (reduce colours)",
        },
      })
      .default("lossless"),
    dither: z
      .boolean()
      .meta({
        label: "Dither",
        control: "switch",
        help: "Smooths banding from colour reduction, at a slightly larger file size.",
        showWhen: { field: "mode", equals: "smaller" },
      })
      .default(true),
  }),
  defaults: { mode: "lossless", dither: true },

  pipeline: [
    {
      op: "compress",
      candidates: [{ engine: "jsquash-png" }],
    },
  ],

  batch: true,
});

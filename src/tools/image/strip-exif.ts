import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Lossless: the image data itself is never re-encoded, only the surrounding
 * metadata segments/chunks are dropped (see `src/lib/engines/exif/strip.ts`)
 * — unlike `imagePipeline`-built tools, which always lose metadata as a
 * side effect of a decode/encode round trip. `produces: "same"` because the
 * output format always matches whatever `accepts` format the input actually
 * sniffed as; see `ToolDefinition.produces`'s doc comment. `op: "strip"` is
 * a single byte-to-byte step (ADR-0007: not every image tool needs the
 * raster pipeline), so no `imagePipeline` call here.
 */
export default defineTool({
  slug: "strip-exif",
  category: "image",
  title: "Remove EXIF Data",
  description:
    "Remove EXIF data from photos, including GPS location and camera details.",

  accepts: ["jpg", "png", "webp"],
  produces: "same",

  options: z.object({
    keepOrientation: z.boolean().meta({
      label: "Keep photo orientation",
      control: "switch",
      help:
        "Without this, a photo taken sideways or upside-down may display " +
        "rotated wrongly once its EXIF is gone.",
    }),
  }),
  defaults: { keepOrientation: true },

  pipeline: [{ op: "strip", candidates: [{ engine: "exif" }] }],

  batch: true,
});

import { defineTool, imagePipeline } from "@/lib/registry";
import { pngDefaults, pngOptions } from "../_shared-options";

/**
 * `canvas`'s `createImageBitmap` decodes only a GIF's first frame (ADR-0007's
 * "animated sources convert as their first frame only" consequence) — an
 * animated GIF converts to a still PNG of its opening frame, not a preview
 * strip or anything smarter.
 */
export default defineTool({
  slug: "gif-to-png",
  category: "image",
  title: "GIF to PNG",
  description:
    "Convert GIF to PNG in your browser — free and private, no upload. " +
    "An animated GIF converts to a still image of its first frame.",

  accepts: ["gif"],
  produces: "png",

  options: pngOptions,
  defaults: pngDefaults,

  pipeline: imagePipeline("gif", "png"),

  batch: true,
});

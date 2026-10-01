import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import { webpDefaults, webpOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("svg", "webp")`: resvg rasterizes, jsquash-webp
 * encodes, and alpha survives. `width` is the resvg adapter's own option key
 * (see `svg-to-png.ts`). No system fonts, so text needs its font embedded in
 * the SVG.
 */
export default defineTool({
  slug: "svg-to-webp",
  category: "image",
  title: "SVG to WebP",
  description:
    "Convert SVG to WebP, with transparency kept. Pick the output width. Text needs its font embedded in the SVG to render.",

  accepts: ["svg"],
  produces: "webp",

  options: webpOptions.extend({
    width: z
      .number()
      .min(1)
      .max(8192)
      .meta({
        label: "Output width",
        control: "number",
        unit: "px",
        help: "Leave empty to keep the SVG's own size",
      })
      .optional(),
  }),
  defaults: webpDefaults,

  pipeline: imagePipeline("svg", "webp"),

  batch: true,
});

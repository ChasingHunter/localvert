import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("svg", "png")` — decode (rasterize) via resvg,
 * encode via jsquash-png/canvas (ADR-0007).
 *
 * `width` matches the resvg adapter's own option key (`options.width`,
 * `../lib/engines/resvg/adapter.ts`'s `buildResvg`): left empty, resvg
 * rasterizes at the SVG's own intrinsic size (capped at 8192px on its long
 * side); given a width, it rasterizes crisply at that target instead of
 * upscaling a small default render. resvg has no system fonts to fall back
 * on, so any text in the SVG needs its font embedded in the file to render.
 */
export default defineTool({
  slug: "svg-to-png",
  category: "image",
  title: "SVG to PNG",
  description:
    "Convert SVG to PNG at any size — free, private, in your browser. " +
    "Renders your vector artwork to a crisp raster PNG; files never leave " +
    "your device. Text needs its font embedded in the SVG, since the " +
    "browser sandbox has no system fonts to fall back on.",

  accepts: ["svg"],
  produces: "png",

  options: z.object({
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
  defaults: {},

  pipeline: imagePipeline("svg", "png"),

  batch: true,
});

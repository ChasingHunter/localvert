import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("svg", "jpg")` — decode (rasterize) via resvg,
 * encode via jsquash-jpeg/canvas (ADR-0007).
 *
 * `jpgOptions` (`quality`/`background`) is shared with every other
 * `*-to-jpg` tool (see `src/tools/_shared-options.ts`), extended here with
 * `width`, which matches the resvg adapter's own option key
 * (`options.width`, `../lib/engines/resvg/adapter.ts`'s `buildResvg`) — see
 * `svg-to-png.ts` for that option's full explanation. jpg has no
 * transparency, so `background` is what the rasterized SVG's alpha
 * composites onto before encoding. resvg has no system fonts to fall back
 * on, so any text in the SVG needs its font embedded in the file to render.
 */
export default defineTool({
  slug: "svg-to-jpg",
  category: "image",
  title: "SVG to JPG",
  description:
    "Convert SVG to JPG — free, private, in your browser. Renders your " +
    "vector artwork onto the background color you choose, since JPG has no " +
    "transparency. Files never leave your device, and text needs its font " +
    "embedded in the SVG to render.",

  accepts: ["svg"],
  produces: "jpg",

  options: jpgOptions.extend({
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
  defaults: jpgDefaults,

  pipeline: imagePipeline("svg", "jpg"),

  batch: true,
});

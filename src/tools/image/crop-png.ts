import { defineTool, imagePipeline } from "@/lib/registry";
import { cropField, pngDefaults, pngOptions } from "../_shared-options";

/**
 * Same shape as `crop-jpg.ts` — see that file's doc comment for the
 * pipeline/engine reasoning and why `batch` is `false`. PNG is lossless, so
 * `pngOptions` contributes nothing but `crop` here (no quality knob, same as
 * `png-to-jpg.ts`'s sibling `jpg-to-png.ts`).
 */
export default defineTool({
  slug: "crop-png",
  category: "image",
  title: "Crop PNG",
  description:
    "Crop a PNG to an exact rectangle, free-form or a fixed aspect ratio " +
    "(1:1, 4:3, 16:9, 3:2) — free, private, in your browser. Files never " +
    "leave your device, and transparency is preserved.",

  accepts: ["png"],
  produces: "png",

  options: pngOptions.extend({ crop: cropField }),
  defaults: pngDefaults,

  pipeline: imagePipeline("png", "png", ["crop"]),

  batch: false,
});

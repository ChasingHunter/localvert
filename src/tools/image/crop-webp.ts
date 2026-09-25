import { defineTool, imagePipeline } from "@/lib/registry";
import { cropField, webpDefaults, webpOptions } from "../_shared-options";

/**
 * Same shape as `crop-jpg.ts` — see that file's doc comment for the
 * pipeline/engine reasoning and why `batch` is `false`. `webpOptions`
 * (`quality`/`lossless`) are shared with every other `*-webp` tool — see
 * `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "crop-webp",
  category: "image",
  title: "Crop WebP",
  description:
    "Crop a WebP to an exact rectangle, free-form or a fixed aspect ratio " +
    "(1:1, 4:3, 16:9, 3:2) — free, private, in your browser. Files never " +
    "leave your device, and transparency is preserved.",

  accepts: ["webp"],
  produces: "webp",

  options: webpOptions.extend({ crop: cropField }),
  defaults: webpDefaults,

  pipeline: imagePipeline("webp", "webp", ["crop"]),

  batch: false,
});

import { defineTool, imagePipeline } from "@/lib/registry";
import { jxlDefaults, jxlOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("png", "jxl")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to `jsquash-png` decode and
 * `jsquash-jxl` encode, both of which preserve alpha, so PNG transparency
 * survives the round trip. jxl has no `canvas` fallback in either direction
 * (see `image-pipeline.ts`'s preference tables), so this tool depends on
 * `jsquash-jxl` actually loading. `jxlOptions`/`jxlDefaults` are shared
 * with every other `*-to-jxl` tool — see `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "png-to-jxl",
  category: "image",
  title: "PNG to JPEG XL",
  description:
    "Convert PNG to JPEG XL (JXL) — smaller files with transparency " +
    "preserved. Free and private: runs in your browser, no upload. " +
    "Re-encoding strips embedded metadata.",

  accepts: ["png"],
  produces: "jxl",

  options: jxlOptions,
  defaults: jxlDefaults,

  pipeline: imagePipeline("png", "jxl"),

  batch: true,
});

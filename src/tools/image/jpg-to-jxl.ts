import { defineTool, imagePipeline } from "@/lib/registry";
import { jxlDefaults, jxlOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("jpg", "jxl")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to `jsquash-jpeg` decode and
 * `jsquash-jxl` encode — jxl has no `canvas` fallback in either direction
 * (see `image-pipeline.ts`'s preference tables), so this tool depends on
 * that one engine actually loading. `jxlOptions`/`jxlDefaults` are shared
 * with every other `*-to-jxl` tool — see `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "jpg-to-jxl",
  category: "image",
  title: "JPG to JPEG XL",
  description:
    "Convert JPG to JPEG XL (JXL) — smaller files with no visible quality " +
    "loss. Free and private: runs in your browser, no upload. " +
    "Re-encoding strips embedded metadata, including GPS location.",

  accepts: ["jpg"],
  produces: "jxl",

  options: jxlOptions,
  defaults: jxlDefaults,

  pipeline: imagePipeline("jpg", "jxl"),

  batch: true,
});

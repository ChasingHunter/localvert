import { defineTool, imagePipeline } from "@/lib/registry";
import { avifDefaults, avifOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("png", "avif")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to `jsquash-png` decode and
 * `jsquash-avif` encode, both of which preserve alpha, so PNG transparency
 * survives the round trip. avif has no `canvas` fallback in either
 * direction (see `image-pipeline.ts`'s preference tables), so this tool
 * depends on `jsquash-avif` actually loading. `avifOptions`/`avifDefaults`
 * are shared with every other `*-to-avif` tool — see
 * `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "png-to-avif",
  category: "image",
  title: "PNG to AVIF",
  description:
    "Convert PNG to AVIF — next-generation compression with transparency " +
    "support. Free and private: runs in your browser, no upload. " +
    "Re-encoding strips embedded metadata.",

  accepts: ["png"],
  produces: "avif",

  options: avifOptions,
  defaults: avifDefaults,

  pipeline: imagePipeline("png", "avif"),

  batch: true,
});

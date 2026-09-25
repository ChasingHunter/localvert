import { defineTool, imagePipeline } from "@/lib/registry";
import { avifDefaults, avifOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("jpg", "avif")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to `jsquash-jpeg` decode and
 * `jsquash-avif` encode — avif has no `canvas` fallback in either direction
 * (see `image-pipeline.ts`'s preference tables), so this tool depends on
 * that one engine actually loading. `avifOptions`/`avifDefaults` are shared
 * with every other `*-to-avif` tool — see `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "jpg-to-avif",
  category: "image",
  title: "JPG to AVIF",
  description:
    "Convert JPG to AVIF — next-generation compression, much smaller " +
    "files than JPG at the same quality. Free and private: runs in your " +
    "browser, no upload. Re-encoding strips embedded metadata, including " +
    "GPS location.",

  accepts: ["jpg"],
  produces: "avif",

  options: avifOptions,
  defaults: avifDefaults,

  pipeline: imagePipeline("jpg", "avif"),

  batch: true,
});

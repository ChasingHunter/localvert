import { defineTool, imagePipeline } from "@/lib/registry";
import { webpDefaults, webpOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("jpg", "webp")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to the jsquash codec on both sides
 * (`jsquash-jpeg` decode, `jsquash-webp` encode), with `canvas` as the
 * fallback the router falls back to only if a jsquash wasm fails to load.
 * `webpOptions`/`webpDefaults` are shared with every other `*-to-webp` tool
 * — see `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "jpg-to-webp",
  category: "image",
  title: "JPG to WebP",
  description:
    "Convert JPG to WebP — smaller files, same look. Free and private: " +
    "runs in your browser, no upload. Re-encoding strips embedded " +
    "metadata, including GPS location.",

  accepts: ["jpg"],
  produces: "webp",

  options: webpOptions,
  defaults: webpDefaults,

  pipeline: imagePipeline("jpg", "webp"),

  batch: true,
});

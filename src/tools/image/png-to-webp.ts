import { defineTool, imagePipeline } from "@/lib/registry";
import { webpDefaults, webpOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("png", "webp")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to `jsquash-png` decode and
 * `jsquash-webp` encode, both of which preserve alpha, so PNG transparency
 * survives the round trip. `webpOptions`/`webpDefaults` are shared with
 * every other `*-to-webp` tool — see `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "png-to-webp",
  category: "image",
  title: "PNG to WebP",
  description:
    "Convert PNG to WebP — smaller files with transparency preserved. " +
    "Free and private: runs in your browser, no upload. Re-encoding " +
    "strips embedded metadata.",

  accepts: ["png"],
  produces: "webp",

  options: webpOptions,
  defaults: webpDefaults,

  pipeline: imagePipeline("png", "webp"),

  batch: true,
});

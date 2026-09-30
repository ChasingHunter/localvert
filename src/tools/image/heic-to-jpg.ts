import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgQualityDefaults, jpgQualityOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("heic", "jpg")` — decode via `heic-to` (ADR-0002,
 * LGPL-3.0), encode via jsquash-jpeg/canvas (ADR-0007). `heic-to` only ever
 * decodes a HEIC/HEIF file's *primary* image; a "Live Photo" HEIC's paired
 * video and a burst's secondary frames are never read.
 *
 * `jpgQualityOptions` (`src/tools/_shared-options.ts`) is just the quality
 * slider: phone HEIC photos are opaque, so the "background for transparent
 * areas" field the other `*-to-jpg` tools carry would do nothing here (the
 * encoder still fills any stray alpha with white).
 */
export default defineTool({
  slug: "heic-to-jpg",
  category: "image",
  categoryRank: 3,
  title: "HEIC to JPG",
  description:
    "Convert HEIC to JPG so iPhone photos open anywhere. Only the primary image in a HEIC file converts, and re-encoding strips embedded metadata, including GPS.",

  accepts: ["heic"],
  produces: "jpg",
  rank: 6,

  options: jpgQualityOptions,
  defaults: jpgQualityDefaults,

  pipeline: imagePipeline("heic", "jpg"),

  batch: true,
});

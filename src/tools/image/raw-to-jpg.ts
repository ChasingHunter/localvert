import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgQualityDefaults, jpgQualityOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("raw", "jpg")` (ADR-0007: decode -> encode),
 * resolving to the `libraw` engine's decode step (ADR-0002: LibRaw is
 * LGPL-2.1/CDDL-1.0 — arms-length per that ADR, same as this repo's other
 * copyleft engines) and the jsquash-jpeg/canvas preference table's encode.
 *
 * `jpgQualityOptions` (`src/tools/_shared-options.ts`) is just the quality
 * slider: camera raw decodes fully opaque (libraw's demosaic never produces
 * alpha), so the background-fill field the other `*-to-jpg` tools carry
 * would do nothing here. `quality` defaults to 0.9 rather than the
 * shared 0.85 — camera raw is already a high-value source image, so this
 * tool biases toward preserving more of it by default.
 *
 * `halfSize` (extended onto `jpgOptions`) is libraw's own faster
 * half-resolution decode — useful for a quick preview of a large raw file
 * without waiting for a full-size demosaic.
 */
export default defineTool({
  slug: "raw-to-jpg",
  category: "image",
  title: "Convert RAW to JPG",
  description:
    "Convert camera RAW photos (CR2, NEF, ARW, DNG and more) to JPG. Decoding and re-encoding strips embedded metadata, including GPS location.",

  accepts: ["raw"],
  produces: "jpg",

  options: jpgQualityOptions.extend({
    halfSize: z.boolean().meta({
      label: "Fast half-size decode",
      control: "switch",
      help: "Decodes at half resolution, faster and good for a quick preview.",
    }),
  }),
  defaults: { ...jpgQualityDefaults, quality: 0.9, halfSize: false },

  pipeline: imagePipeline("raw", "jpg"),

  batch: true,
});

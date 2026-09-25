import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("raw", "jpg")` (ADR-0007: decode -> encode),
 * resolving to the `libraw` engine's decode step (ADR-0002: LibRaw is
 * LGPL-2.1/CDDL-1.0 — arms-length per that ADR, same as this repo's other
 * copyleft engines) and the jsquash-jpeg/canvas preference table's encode.
 *
 * `jpgOptions`/`jpgDefaults` (`quality`/`background`) are shared with every
 * other `*-to-jpg` tool — see `src/tools/_shared-options.ts` — so the form
 * matches the rest of the family. JPG has no alpha channel, so an encode
 * with any transparency needs a fill color; camera raw decodes fully opaque
 * (libraw's demosaic never produces alpha), so `background` is a no-op here
 * in practice, but keeping the field means the form looks the same whichever
 * "-to-jpg" tool a user picks. `quality` defaults to 0.9 rather than the
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
  title: "Convert RAW to JPG — CR2, NEF, ARW, DNG and more, in your browser",
  description:
    "Convert camera RAW photos — CR2, NEF, ARW, DNG and more — to JPG. " +
    "Free, private, in your browser. Files never leave your device. " +
    "Decoding through libraw and re-encoding strips embedded metadata, " +
    "including GPS location.",

  accepts: ["raw"],
  produces: "jpg",

  options: jpgOptions.extend({
    halfSize: z.boolean().meta({
      label: "Fast half-size decode",
      control: "switch",
      help: "Decodes at half resolution — faster, good for a quick preview.",
    }),
  }),
  defaults: { ...jpgDefaults, quality: 0.9, halfSize: false },

  pipeline: imagePipeline("raw", "jpg"),

  batch: true,
});

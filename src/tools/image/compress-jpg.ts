import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * `targetSizeKB` is the whole point of this tool: pick a byte budget instead
 * of a quality number. It's optional — `quality` alone is a perfectly valid
 * way to compress — so the two knobs coexist, and the engine adapter
 * (`jsquash-jpeg`'s `runEncode`) prefers `targetSizeKB` whenever it's set,
 * bisecting `quality` internally (`src/lib/engines/shared/target-size.ts`)
 * to hit it. Both fields must carry `.meta()` *before* `.optional()`/
 * `.default()` — see `src/lib/options/fields.ts`'s `unwrap` doc comment;
 * meta registered after a wrapper is invisible to it.
 */
export default defineTool({
  slug: "compress-jpg",
  category: "image",
  title: "Compress JPG to a Target Size",
  description:
    "Shrink a JPG file — to a target size (e.g. under 200 KB) or a quality " +
    "level you choose — free, private, in your browser. Files never leave " +
    "your device. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["jpg"],
  produces: "jpg",

  options: z.object({
    targetSizeKB: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .meta({
        label: "Target size",
        control: "number",
        unit: "KB",
        help: "Leave empty to use Quality instead",
      })
      .optional(),
    quality: z
      .number()
      .min(0.05)
      .max(1)
      .meta({ label: "Quality", control: "slider" })
      .default(0.75),
  }),
  defaults: { quality: 0.75 },

  pipeline: imagePipeline("jpg", "jpg"),

  batch: true,
});

import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Same shape as `compress-jpg.ts` — see that file's doc comment for why
 * `targetSizeKB` and `quality` coexist, and why `.meta()` must come before
 * `.optional()`/`.default()`. The engine adapter (`jsquash-webp`'s
 * `runEncode`) prefers `targetSizeKB` when set, bisecting `quality` via
 * `encodeToTargetSize` to hit it.
 */
export default defineTool({
  slug: "compress-webp",
  category: "image",
  title: "Compress WebP to a Target Size",
  description:
    "Shrink a WebP file — to a target size (e.g. under 200 KB) or a " +
    "quality level you choose — free, private, in your browser. Files " +
    "never leave your device. Re-encoding strips embedded metadata, " +
    "including GPS.",

  accepts: ["webp"],
  produces: "webp",

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

  pipeline: imagePipeline("webp", "webp"),

  batch: true,
});

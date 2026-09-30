import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import {
  resizeDefaults,
  resizeFields,
  resizeReadiness,
} from "../_resize-options";

/**
 * Same shape as `resize-image-jpg.ts` — see that file's doc comment.
 */
export default defineTool({
  slug: "resize-image-webp",
  category: "image",
  title: "Resize WebP",
  description:
    "Resize a WebP by percentage or to an exact size. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["webp"],
  produces: "webp",

  options: z.object({
    ...resizeFields,
    quality: z
      .number()
      .min(0.05)
      .max(1)
      .meta({ label: "Quality", control: "slider" })
      .default(0.75),
  }),
  defaults: { ...resizeDefaults, quality: 0.75 },
  actionLabel: "Resize",
  readiness: resizeReadiness,

  pipeline: imagePipeline("webp", "webp", ["resize"]),

  batch: true,
});

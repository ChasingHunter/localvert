import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import {
  resizeDefaults,
  resizeFields,
  resizeReadiness,
} from "../_resize-options";

/**
 * Same shape as `resize-image-jpg.ts` minus `quality` — PNG is lossless, so
 * there's no quality knob to expose (same reasoning as `jpg-to-png.ts`). See
 * that file's doc comment for `width`/`height`/`fit`/`allowUpscale`.
 */
export default defineTool({
  slug: "resize-image-png",
  category: "image",
  title: "Resize PNG",
  description:
    "Resize a PNG by percentage or to an exact size. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["png"],
  produces: "png",

  options: z.object({
    ...resizeFields,
  }),
  defaults: { ...resizeDefaults },
  actionLabel: "Resize",
  readiness: resizeReadiness,

  pipeline: imagePipeline("png", "png", ["resize"]),

  batch: true,
});

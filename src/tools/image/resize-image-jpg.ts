import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";
import {
  resizeDefaults,
  resizeFields,
  resizeReadiness,
} from "../_resize-options";

/**
 * Resize fields live in `../_resize-options.ts`, shared by the three resize
 * tools: "By percentage" (default 50%) or "Exact size" (width and/or height,
 * with `fit`/`allowUpscale`, as in `ResizeOptions` in
 * `src/lib/engines/shared/resize-box.ts`). Exact size with both blank waits
 * for input (`readiness`) instead of passing the file through unchanged.
 * `quality` controls the re-encode, same as `compress-jpg`.
 */
export default defineTool({
  slug: "resize-image-jpg",
  category: "image",
  categoryRank: 6,
  title: "Resize JPG",
  description:
    "Resize a JPG by percentage or to an exact size. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["jpg"],
  produces: "jpg",

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

  pipeline: imagePipeline("jpg", "jpg", ["resize"]),

  batch: true,
});

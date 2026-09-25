import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Same shape as `resize-image-jpg.ts` — see that file's doc comment.
 */
export default defineTool({
  slug: "resize-image-webp",
  category: "image",
  title: "Resize WebP",
  description:
    "Resize a WebP by width, height, or both — free, private, in your " +
    "browser. Files never leave your device. Re-encoding strips embedded " +
    "metadata, including GPS.",

  accepts: ["webp"],
  produces: "webp",

  options: z.object({
    width: z
      .number()
      .int()
      .positive()
      .meta({ label: "Width", control: "number", unit: "px" })
      .optional(),
    height: z
      .number()
      .int()
      .positive()
      .meta({ label: "Height", control: "number", unit: "px" })
      .optional(),
    fit: z
      .enum(["contain", "cover", "fill"])
      .meta({
        label: "Fit",
        control: "select",
        help: "How width and height combine when both are set",
      })
      .default("contain"),
    allowUpscale: z
      .boolean()
      .meta({ label: "Allow upscale", control: "switch" })
      .default(false),
    quality: z
      .number()
      .min(0.05)
      .max(1)
      .meta({ label: "Quality", control: "slider" })
      .default(0.75),
  }),
  defaults: { fit: "contain", allowUpscale: false, quality: 0.75 },

  pipeline: imagePipeline("webp", "webp", ["resize"]),

  batch: true,
});

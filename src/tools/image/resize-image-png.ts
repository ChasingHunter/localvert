import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

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
    "Resize a PNG by width, height, or both — free, private, in your " +
    "browser. Files never leave your device. Re-encoding strips embedded " +
    "metadata, including GPS.",

  accepts: ["png"],
  produces: "png",

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
  }),
  defaults: { fit: "contain", allowUpscale: false },

  pipeline: imagePipeline("png", "png", ["resize"]),

  batch: true,
});

import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * `width`/`height` are both optional — the `resize` step's engines
 * (`jsquash-resize`, `canvas`; see `src/lib/engines/shared/resize-box.ts`)
 * pass through unchanged when neither is set, and scale by whichever one is
 * given when only one is. `fit`/`allowUpscale` mirror `ResizeOptions` in
 * that same file exactly, so the option form's vocabulary matches the
 * engines' own. `quality` controls the re-encode, same as `compress-jpg`.
 * Every field's `.meta()` comes before `.optional()`/`.default()` — see
 * `src/lib/options/fields.ts`'s `unwrap` doc comment.
 */
export default defineTool({
  slug: "resize-image-jpg",
  category: "image",
  title: "Resize JPG",
  description:
    "Resize a JPG by width, height, or both — free, private, in your " +
    "browser. Files never leave your device. Re-encoding strips embedded " +
    "metadata, including GPS.",

  accepts: ["jpg"],
  produces: "jpg",

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

  pipeline: imagePipeline("jpg", "jpg", ["resize"]),

  batch: true,
});

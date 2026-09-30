import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/** Same shape as `rotate-jpg.ts` — see that file's doc comment. */
export default defineTool({
  slug: "rotate-webp",
  category: "image",
  title: "Rotate WebP",
  description:
    "Rotate a WebP 90, 180 or 270 degrees clockwise. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["webp"],
  produces: "webp",

  options: z.object({
    rotate: z
      .enum(["90", "180", "270"])
      .meta({
        label: "Rotate",
        control: "select",
        optionLabels: {
          "90": "90\u00b0 clockwise",
          "180": "180\u00b0",
          "270": "270\u00b0 clockwise",
        },
      })
      .default("90"),
  }),
  defaults: { rotate: "90" },

  pipeline: imagePipeline("webp", "webp", ["rotate"]),

  batch: true,
});

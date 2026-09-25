import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/** Same shape as `rotate-jpg.ts` — see that file's doc comment. */
export default defineTool({
  slug: "rotate-png",
  category: "image",
  title: "Rotate PNG",
  description:
    "Rotate a PNG 90, 180, or 270 degrees clockwise — free, private, in " +
    "your browser. Files never leave your device. Re-encoding strips " +
    "embedded metadata, including GPS.",

  accepts: ["png"],
  produces: "png",

  options: z.object({
    rotate: z
      .enum(["90", "180", "270"])
      .meta({ label: "Rotate", control: "select" })
      .default("90"),
  }),
  defaults: { rotate: "90" },

  pipeline: imagePipeline("png", "png", ["rotate"]),

  batch: true,
});

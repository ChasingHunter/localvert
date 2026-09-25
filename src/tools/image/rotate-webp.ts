import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/** Same shape as `rotate-jpg.ts` — see that file's doc comment. */
export default defineTool({
  slug: "rotate-webp",
  category: "image",
  title: "Rotate WebP",
  description:
    "Rotate a WebP 90, 180, or 270 degrees clockwise — free, private, in " +
    "your browser. Files never leave your device. Re-encoding strips " +
    "embedded metadata, including GPS.",

  accepts: ["webp"],
  produces: "webp",

  options: z.object({
    rotate: z
      .enum(["90", "180", "270"])
      .meta({ label: "Rotate", control: "select" })
      .default("90"),
  }),
  defaults: { rotate: "90" },

  pipeline: imagePipeline("webp", "webp", ["rotate"]),

  batch: true,
});

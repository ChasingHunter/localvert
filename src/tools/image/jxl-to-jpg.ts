import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Same `quality`/`background` option shape as `webp-to-jpg` — see that
 * file's doc comment for why `background` is declared here even though the
 * pipeline's preferred jpg-encode candidate (`jsquash-jpeg`) doesn't
 * actually read it; only the `canvas` fallback candidate does.
 */
export default defineTool({
  slug: "jxl-to-jpg",
  category: "image",
  title: "JPEG XL to JPG",
  description:
    "Convert JPEG XL (JXL) to JPG — open JXL images anywhere. Free, " +
    "private, runs in your browser. Re-encoding strips embedded metadata, " +
    "including GPS.",

  accepts: ["jxl"],
  produces: "jpg",

  options: z.object({
    quality: z
      .number()
      .min(0.1)
      .max(1)
      .meta({ label: "Quality", control: "slider" }),
    background: z.string().meta({
      label: "Background for transparent areas",
      control: "text",
    }),
  }),
  defaults: { quality: 0.85, background: "#ffffff" },

  pipeline: imagePipeline("jxl", "jpg"),

  batch: true,
});

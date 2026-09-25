import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * jpg is a lossy, alpha-free target, so this tool exposes both a `quality`
 * knob and a `background` fill for whatever was transparent in the source
 * WebP. `background` is read by the canvas engine's jpg encode path (see
 * `src/lib/engines/canvas/adapter.ts`); the preferred candidate for this
 * pipeline's encode step is `jsquash-jpeg` (ADR-0007's codec preference
 * table), whose adapter only reads `options.quality`/`options.progressive`
 * and does not composite a background before encoding — see this slice's
 * report for the mismatch. The option is kept here regardless, both because
 * canvas is still the declared fallback candidate and to match the option
 * shape every jpg-producing tool in this batch shares.
 */
export default defineTool({
  slug: "webp-to-jpg",
  category: "image",
  title: "WebP to JPG",
  description:
    "Convert WebP to JPG — open WebP images anywhere. Free, private, runs " +
    "in your browser. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["webp"],
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

  pipeline: imagePipeline("webp", "jpg"),

  batch: true,
});

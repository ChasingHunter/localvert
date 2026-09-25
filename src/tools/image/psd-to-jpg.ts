import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("psd", "jpg")` — decode via `@webtoon/psd`,
 * encode via jsquash-jpeg/canvas (ADR-0007). The decode is the PSD's own
 * *flattened composite* (the "merged image" Photoshop stores in the file,
 * not a from-scratch layer composite), and only 8-bit-per-channel, non-CMYK
 * PSDs decode at all (`../lib/engines/psd/adapter.ts`'s `runDecode`).
 *
 * `quality`/`background` mirror the canvas and jsquash-jpeg adapters' own
 * option keys (`options.quality`, `options.background`) — jpg has no
 * transparency, so `background` is what the composite's alpha composites
 * onto before encoding.
 */
export default defineTool({
  slug: "psd-to-jpg",
  category: "image",
  title: "PSD to JPG",
  description:
    "Flatten a Photoshop PSD to JPG without opening Photoshop — free, " +
    "private, in your browser. Uses the file's own flattened composite " +
    "(8-bit RGB only), re-encoded onto the background color you choose. " +
    "Files never leave your device.",

  accepts: ["psd"],
  produces: "jpg",

  options: z.object({
    quality: z
      .number()
      .min(0.1)
      .max(1)
      .meta({ label: "Quality", control: "slider" }),
    background: z.string().meta({
      label: "Background color",
      control: "text",
      help: "Fills transparent areas — JPG has no transparency of its own.",
    }),
  }),
  defaults: { quality: 0.85, background: "#ffffff" },

  pipeline: imagePipeline("psd", "jpg"),

  batch: true,
});

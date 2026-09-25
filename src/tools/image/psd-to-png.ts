import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("psd", "png")` — decode via `@webtoon/psd`,
 * encode via jsquash-png/canvas (ADR-0007). The decode is the PSD's own
 * *flattened composite* (the "merged image" Photoshop stores in the file,
 * not a from-scratch layer composite), and only 8-bit-per-channel, non-CMYK
 * PSDs decode at all (`../lib/engines/psd/adapter.ts`'s `runDecode`).
 *
 * No options, same reasoning as `jpg-to-png.ts`: PNG is lossless, so there
 * is no quality knob, and the raster intermediate has no way to carry PSD
 * metadata through the round trip.
 */
export default defineTool({
  slug: "psd-to-png",
  category: "image",
  title: "PSD to PNG — flatten Photoshop files without Photoshop",
  description:
    "Flatten a Photoshop PSD to PNG without opening Photoshop — free, " +
    "private, in your browser. Uses the file's own flattened composite " +
    "(8-bit RGB only); files never leave your device.",

  accepts: ["psd"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("psd", "png"),

  batch: true,
});

import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("heic", "png")` — decode via `heic-to`
 * (ADR-0002, LGPL-3.0), encode via jsquash-png/canvas (ADR-0007). `heic-to`
 * only ever decodes a HEIC/HEIF file's *primary* image; a "Live Photo"
 * HEIC's paired video and a burst's secondary frames are never read.
 *
 * No options, same reasoning as `jpg-to-png.ts`: PNG is lossless, so there is
 * no quality knob, and the raster intermediate has no way to carry HEIC's
 * embedded metadata (including GPS) through the round trip.
 */
export default defineTool({
  slug: "heic-to-png",
  category: "image",
  title: "HEIC to PNG",
  description:
    "Convert HEIC to PNG — open iPhone photos on any device, free and " +
    "private, in your browser. Files never leave your device. Only the " +
    "primary image in a HEIC file is converted, and re-encoding strips " +
    "embedded metadata, including GPS location.",

  accepts: ["heic"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("heic", "png"),

  batch: true,
});

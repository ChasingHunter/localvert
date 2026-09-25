import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("tiff", "png")` — decode via utif2, encode via
 * jsquash-png/canvas (ADR-0007). `utif2` decodes a multi-page TIFF's
 * *first* page only (`../lib/engines/utif/adapter.ts`'s `runDecode`); later
 * pages are never read.
 *
 * No options, same reasoning as `jpg-to-png.ts`: PNG is lossless, so there
 * is no quality knob, and the raster intermediate has no way to carry
 * TIFF's embedded metadata (including GPS) through the round trip.
 */
export default defineTool({
  slug: "tiff-to-png",
  category: "image",
  title: "TIFF to PNG",
  description:
    "Convert TIFF to PNG — free, private, in your browser. Only the first " +
    "page of a multi-page TIFF is converted. Files never leave your " +
    "device, and re-encoding strips embedded metadata, including GPS " +
    "location.",

  accepts: ["tiff"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("tiff", "png"),

  batch: true,
});

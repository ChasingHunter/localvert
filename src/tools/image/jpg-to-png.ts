import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * The simplest possible tool: no options. PNG is lossless, so there is no
 * quality knob to expose — the decode/encode round trip is always lossless.
 * That round trip drops embedded metadata (EXIF, including GPS) on every
 * run; see the canvas adapter's own doc comment. There is no "keep metadata"
 * option here the way a JPG-producing tool might offer one — the raster
 * intermediate has no way to carry EXIF through at all, so the description
 * says so instead of promising a control that cannot exist.
 *
 * Pipeline is `imagePipeline("jpg", "png")` (ADR-0007: decode -> encode,
 * no transforms) rather than a single `transcode` step — see
 * docs/ADDING_A_TOOL.md. Today that resolves to canvas on both sides (the
 * only engine registered yet); the jsquash codecs from the preference table
 * take over automatically once their adapters land, with no change here.
 */
export default defineTool({
  slug: "jpg-to-png",
  category: "image",
  title: "JPG to PNG",
  description:
    "Convert JPG to PNG — free, private, in your browser. Files never leave " +
    "your device. Re-encoding through canvas strips embedded metadata, " +
    "including GPS location.",

  accepts: ["jpg"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("jpg", "png"),

  batch: true,
});

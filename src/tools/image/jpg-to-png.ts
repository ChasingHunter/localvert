import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The simplest possible tool: no options. PNG is lossless, so there is no
 * quality knob to expose — the canvas engine always re-encodes losslessly.
 * That re-encode drops embedded metadata (EXIF, including GPS) on every run;
 * see the canvas adapter's own doc comment. There is no "keep metadata"
 * option here the way a JPG-producing tool might offer one — canvas has no
 * way to carry EXIF through a re-encode at all, so the description says so
 * instead of promising a control that cannot exist.
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

  pipeline: [{ op: "transcode", candidates: [{ engine: "canvas" }] }],

  batch: true,
});

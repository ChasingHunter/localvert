import { defineTool, imagePipeline } from "@/lib/registry";
import { pngDefaults, pngOptions } from "../_shared-options";

/**
 * A multi-size .ico decodes its single largest embedded entry — see
 * `canvas/ico.ts`'s `pickLargestIcoEntry` — not every size as separate
 * outputs. A Vista+ (PNG-compressed) entry decodes through the ordinary PNG
 * path; a legacy DIB entry is decoded by hand (`decodeIcoDib`).
 */
export default defineTool({
  slug: "ico-to-png",
  category: "image",
  title: "ICO to PNG",
  description:
    "Convert a Windows icon (.ico) to PNG, extracting the largest size embedded in the icon.",

  accepts: ["ico"],
  produces: "png",

  options: pngOptions,
  defaults: pngDefaults,

  pipeline: imagePipeline("ico", "png"),

  batch: true,
});

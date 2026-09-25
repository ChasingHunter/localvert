import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("tiff", "jpg")` — decode via utif2, encode via
 * jsquash-jpeg/canvas (ADR-0007). `utif2` decodes a multi-page TIFF's
 * *first* page only (`../lib/engines/utif/adapter.ts`'s `runDecode`);
 * later pages are never read.
 *
 * `jpgOptions`/`jpgDefaults` are shared with every other `*-to-jpg` tool
 * (see `src/tools/_shared-options.ts`) — jpg has no transparency, so
 * `background` is what a decoded page's alpha (if any) composites onto
 * before encoding.
 */
export default defineTool({
  slug: "tiff-to-jpg",
  category: "image",
  title: "TIFF to JPG",
  description:
    "Convert TIFF to JPG — free, private, in your browser. Only the first " +
    "page of a multi-page TIFF is converted. Files never leave your " +
    "device, and re-encoding strips embedded metadata, including GPS " +
    "location.",

  accepts: ["tiff"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("tiff", "jpg"),

  batch: true,
});

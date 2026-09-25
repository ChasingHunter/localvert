import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("psd", "jpg")` — decode via `@webtoon/psd`,
 * encode via jsquash-jpeg/canvas (ADR-0007). The decode is the PSD's own
 * *flattened composite* (the "merged image" Photoshop stores in the file,
 * not a from-scratch layer composite), and only 8-bit-per-channel, non-CMYK
 * PSDs decode at all (`../lib/engines/psd/adapter.ts`'s `runDecode`).
 *
 * `jpgOptions`/`jpgDefaults` are shared with every other `*-to-jpg` tool
 * (see `src/tools/_shared-options.ts`) — jpg has no transparency, so
 * `background` is what the composite's alpha composites onto before
 * encoding.
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

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("psd", "jpg"),

  batch: true,
});

import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). See wav-to-mp3.ts for
 * why MP3 needs the LAME wasm encoder registered first. */
export default defineTool({
  slug: "flac-to-mp3",
  category: "audio",
  title: "FLAC to MP3",
  description:
    "Convert FLAC to MP3 — much smaller files, still widely compatible. " +
    "Free and private: runs in your browser, no upload.",

  accepts: ["flac"],
  produces: "mp3",

  options: lossyAudioOptions,
  defaults: lossyAudioDefaults,

  pipeline: [
    {
      op: "transcode",
      candidates: [{ engine: "mediabunny" }],
    },
  ],

  batch: true,
});

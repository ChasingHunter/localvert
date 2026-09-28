import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). See wav-to-mp3.ts for
 * why MP3 needs the LAME wasm encoder registered first. */
export default defineTool({
  slug: "flac-to-mp3",
  category: "audio",
  title: "FLAC to MP3",
  description:
    "Convert FLAC to MP3 for a much smaller file that still plays everywhere.",

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

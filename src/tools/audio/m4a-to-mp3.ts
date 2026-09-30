import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). See wav-to-mp3.ts for
 * why MP3 needs the LAME wasm encoder registered first. */
export default defineTool({
  slug: "m4a-to-mp3",
  category: "audio",
  categoryRank: 3,
  title: "M4A to MP3",
  description:
    "Convert M4A (AAC) to MP3, the format that plays on nearly every device and app.",

  accepts: ["m4a"],
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

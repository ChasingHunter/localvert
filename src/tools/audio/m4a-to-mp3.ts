import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). See wav-to-mp3.ts for
 * why MP3 needs the LAME wasm encoder registered first. */
export default defineTool({
  slug: "m4a-to-mp3",
  category: "audio",
  title: "M4A to MP3",
  description:
    "Convert M4A (AAC) to MP3 — the most widely compatible audio format. " +
    "Free and private: runs in your browser, no upload.",

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

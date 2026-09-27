import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). See wav-to-mp3.ts for
 * why MP3 needs the LAME wasm encoder registered first. Accepts Ogg
 * Vorbis; a dropped `.opus` file sniffs as `ogg` too (see that format's own
 * accepted-gap note in formats.ts) and converts the same way. */
export default defineTool({
  slug: "ogg-to-mp3",
  category: "audio",
  title: "Ogg to MP3",
  description:
    "Convert Ogg Vorbis to MP3 — the most widely compatible audio format. " +
    "Free and private: runs in your browser, no upload.",

  accepts: ["ogg"],
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

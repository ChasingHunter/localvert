import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010) — same "video container
 * in, audio-only out" path as `extract-audio`, but with a fixed mp3 output
 * rather than a runtime-selectable one. See wav-to-mp3.ts for why MP3 needs
 * the LAME wasm encoder registered first. */
export default defineTool({
  slug: "webm-to-mp3",
  category: "audio",
  title: "WebM to MP3",
  description:
    "Extract the audio from a WebM video as MP3. Free and private: runs " +
    "in your browser, no upload.",

  accepts: ["webm"],
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

import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010) — same "video container
 * in, audio-only out" path as `extract-audio`, but with a fixed mp3 output
 * rather than a runtime-selectable one. See wav-to-mp3.ts for why MP3 needs
 * the LAME wasm encoder registered first. */
export default defineTool({
  slug: "mp4-to-mp3",
  category: "audio",
  categoryRank: 1,
  title: "MP4 to MP3",
  description: "Pull the audio out of an MP4 video as MP3.",

  accepts: ["mp4"],
  produces: "mp3",
  rank: 3,

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

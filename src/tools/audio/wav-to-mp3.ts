import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). MP3 needs the LAME wasm
 * encoder (`@mediabunny/mp3-encoder`) registered first — no browser's
 * WebCodecs can encode MP3 natively; see `src/lib/engines/mediabunny/
 * audio.ts`'s `ensureMp3Encoder`. */
export default defineTool({
  slug: "wav-to-mp3",
  category: "audio",
  categoryRank: 2,
  title: "WAV to MP3",
  description:
    "Convert WAV to MP3 for a much smaller file that still plays everywhere.",

  accepts: ["wav"],
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

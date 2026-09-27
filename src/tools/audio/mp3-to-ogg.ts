import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). Ogg output is encoded
 * with Opus (falling back to Vorbis if the browser can't encode Opus) —
 * see `src/lib/engines/mediabunny/audio.ts`'s `outputPlan`. */
export default defineTool({
  slug: "mp3-to-ogg",
  category: "audio",
  title: "MP3 to Ogg",
  description:
    "Convert MP3 to Ogg (Opus) — smaller, royalty-free, open format. " +
    "Free and private: runs in your browser, no upload.",

  accepts: ["mp3"],
  produces: "ogg",

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

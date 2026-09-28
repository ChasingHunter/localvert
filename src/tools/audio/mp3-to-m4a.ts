import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). M4A output is an
 * audio-only MP4 container (mediabunny's `Mp4OutputFormat`) carrying AAC,
 * probed via `canEncodeAudio("aac")` — see `src/lib/engines/mediabunny/
 * audio.ts`'s `outputPlan`. If the browser can't encode AAC, the job fails
 * with a clear "your browser can't encode m4a" error. */
export default defineTool({
  slug: "mp3-to-m4a",
  category: "audio",
  title: "MP3 to M4A",
  description:
    "Convert MP3 to M4A (AAC), the format Apple devices use by default.",

  accepts: ["mp3"],
  produces: "m4a",

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

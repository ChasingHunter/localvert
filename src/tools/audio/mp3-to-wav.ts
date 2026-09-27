import { defineTool } from "@/lib/registry";
import {
  losslessAudioDefaults,
  losslessAudioOptions,
} from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). WAV output is PCM,
 * encoded by mediabunny itself (no WebCodecs, no capability probe needed) —
 * see `src/lib/engines/mediabunny/audio.ts`'s `outputPlan`. No bitrate
 * option: PCM has no bitrate knob, unlike the lossy targets. */
export default defineTool({
  slug: "mp3-to-wav",
  category: "audio",
  title: "MP3 to WAV",
  description:
    "Convert MP3 to WAV — uncompressed PCM audio for editing or archival. " +
    "Free and private: runs in your browser, no upload.",

  accepts: ["mp3"],
  produces: "wav",

  options: losslessAudioOptions,
  defaults: losslessAudioDefaults,

  pipeline: [
    {
      op: "transcode",
      candidates: [{ engine: "mediabunny" }],
    },
  ],

  batch: true,
});

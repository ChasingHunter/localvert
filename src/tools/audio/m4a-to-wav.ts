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
  slug: "m4a-to-wav",
  category: "audio",
  title: "M4A to WAV",
  description:
    "Convert M4A (AAC) to WAV — uncompressed PCM audio for editing or " +
    "archival. Free and private: runs in your browser, no upload.",

  accepts: ["m4a"],
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

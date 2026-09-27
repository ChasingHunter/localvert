import { defineTool } from "@/lib/registry";
import {
  losslessAudioDefaults,
  losslessAudioOptions,
} from "../_shared-options";

/** Phase 3b, mediabunny audio pipeline (ADR-0010). FLAC is lossless like
 * WAV, but compressed — losslessAudioOptions (no bitrate knob), same as
 * mp3-to-wav.ts. FLAC support is probed via `canEncodeAudio("flac")`; if
 * the browser can't encode it, the job fails with a clear "your browser
 * can't encode flac" error rather than silently changing format. */
export default defineTool({
  slug: "wav-to-flac",
  category: "audio",
  title: "WAV to FLAC",
  description:
    "Convert WAV to FLAC — lossless compression, smaller than WAV with no " +
    "quality loss. Free and private: runs in your browser, no upload.",

  accepts: ["wav"],
  produces: "flac",

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

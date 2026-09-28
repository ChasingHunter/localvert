import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/**
 * Phase 3b, mediabunny audio pipeline (ADR-0010). Opus here is an Ogg Opus
 * file (`FORMATS.opus` — the "OggS" container `refineFormat` upgrades from
 * `ogg` by extension). `"opus"` was already in `audio.ts`'s
 * `AUDIO_INPUT_FORMATS`, and mediabunny's `Input` reads it through its own
 * `OggInputFormat`/`OggDemuxer` (part of `ALL_FORMATS`, see `output.ts`'s
 * `runConversion`) — confirmed in `mediabunny`'s published dist
 * (`dist/modules/src/input-format.js`'s `OggInputFormat`), which demuxes
 * whichever codec the Ogg page's payload identifies, Opus included. No
 * engine change needed for this tool. See wav-to-mp3.ts for why MP3 needs
 * the LAME wasm encoder registered first.
 */
export default defineTool({
  slug: "opus-to-mp3",
  category: "audio",
  title: "Opus to MP3",
  description:
    "Convert Opus to MP3, the format that plays on nearly every device and app.",

  accepts: ["opus"],
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

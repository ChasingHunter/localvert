import { defineTool } from "@/lib/registry";
import { lossyAudioDefaults, lossyAudioOptions } from "../_shared-options";

/**
 * Phase 3b, mediabunny audio pipeline (ADR-0010). AAC here means a raw ADTS
 * bitstream (`FORMATS.aac`'s magic — the bare `.aac` files browsers and
 * encoders produce, not M4A's ISO-BMFF container, which is `m4a-to-mp3`'s
 * job). mediabunny's `Input` is built with `ALL_FORMATS` (see
 * `output.ts`'s `runConversion`), which includes its own `AdtsInputFormat` —
 * confirmed in `mediabunny`'s published dist
 * (`dist/modules/src/adts/adts-demuxer.js`, `input-format.js`'s
 * `AdtsInputFormat`/`ADTS` singleton) — so this needed only adding `"aac"`
 * to `audio.ts`'s `AUDIO_INPUT_FORMATS`, no new engine wiring. See
 * wav-to-mp3.ts for why MP3 needs the LAME wasm encoder registered first.
 */
export default defineTool({
  slug: "aac-to-mp3",
  category: "audio",
  title: "AAC to MP3",
  description:
    "Convert AAC to MP3, the format that plays on nearly every device and app.",

  accepts: ["aac"],
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

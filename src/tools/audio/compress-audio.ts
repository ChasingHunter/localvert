import { z } from "zod";
import { defineTool } from "@/lib/registry";
import { audioChannelsSelect } from "../_shared-options";

/**
 * ADR-0013: lossy by nature — there's no lossless "shrink an already-lossy
 * mp3/m4a/ogg/opus file" move, unlike the image/PDF compress tools in this
 * same slice. `produces: "same"` (mirrors `compress-video.ts` and
 * `strip-exif.ts`) is how this expresses "output format = input format":
 * `job-engine.ts`'s `buildSteps` resolves `"same"` to whichever of `accepts`
 * the dropped file actually sniffed as, so mediabunny's `runAudioTranscode`
 * re-encodes into the *same* container/codec it decoded, just at a lower
 * bitrate (and optionally downmixed to mono) — never a format conversion.
 * `neverLarger: true` (see that field's doc comment on `ToolDefinition`) is
 * enforced in `job-engine.ts` rather than inside the `mediabunny` adapter,
 * since a large output here may stream straight to OPFS instead of living
 * in memory (ADR-0010) — the adapter itself never holds both the original
 * and final bytes in hand at once the way an image/PDF compress adapter
 * does.
 */
export default defineTool({
  slug: "compress-audio",
  category: "audio",
  title: "Compress Audio",
  description:
    "Shrink an MP3, M4A, Ogg or Opus file by lowering its bitrate — free, " +
    "private, in your browser. Files never leave your device. Lossy: " +
    "quality drops with the bitrate. Never makes the file bigger.",

  accepts: ["mp3", "m4a", "ogg", "opus"],
  produces: "same",

  options: z.object({
    bitrate: z
      .enum(["64", "96", "128"])
      .meta({ label: "Bitrate", control: "select", unit: "kbps" })
      .default("96"),
    channels: audioChannelsSelect,
  }),
  defaults: { bitrate: "96", channels: "keep" },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
  neverLarger: true,
});

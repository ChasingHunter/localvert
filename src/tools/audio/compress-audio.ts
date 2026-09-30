import { z } from "zod";
import { defineTool } from "@/lib/registry";
import { audioChannelsSelect } from "../_shared-options";

/**
 * ADR-0013 (lossy by nature) + ADR-0017 (smart compression modes). See the
 * ADR-0013 half of this comment on prior versions of this file for why
 * `produces: "same"` and `neverLarger: true` are the right shape here — that
 * reasoning is unchanged. ADR-0017 adds three modes on top of the original
 * fixed bitrate select:
 *
 * - `"best"` (the new default): a bitrate below the source's own, picked by
 *   `src/lib/engines/mediabunny/audio-target.ts`'s `bestQualityBitrate` —
 *   never larger, no number to type in.
 * - `"target-size"`/`"percent"`: a byte budget (direct, or source size *
 *   (1 - percent/100)) run through that same file's `bitrateForTargetSize`,
 *   which snaps to a rate the chosen codec accepts and downmixes to mono
 *   below the stereo floor (see its doc comment for the exact ladder).
 * - `"custom"`: the original fixed 64/96/128 kbps select, unchanged.
 *
 * `channels` is shown only in `"custom"` mode — the other three modes decide
 * mono-vs-stereo themselves as part of fitting the target (see
 * `bitrateForTargetSize`), so a visible `channels` control there would just
 * be overridden and confuse what actually happened.
 *
 * No pre-run size estimate in this options form: reading a dropped file's
 * duration before the job starts would need `OptionsForm` to read the file
 * itself (it doesn't today — see `src/components/options-form.tsx`), which
 * is a bigger change than this slice's budget covers. The estimate instead
 * lands in the *result* note (ADR-0017's "Result contract"), which the
 * engine already computes from the real encode. Documented as a deliberate
 * scope cut, not an oversight — see docs/adr/0017-smart-compression.md.
 */
export default defineTool({
  slug: "compress-audio",
  category: "audio",
  title: "Compress Audio",
  description:
    "Shrink an MP3, M4A, Ogg or Opus file. Pick a target size or percentage, or let us pick a lower bitrate for you. Never makes the file bigger.",

  accepts: ["mp3", "m4a", "ogg", "opus"],
  produces: "same",

  options: z.object({
    mode: z
      .enum(["best", "target-size", "percent", "custom"])
      .meta({
        label: "Mode",
        control: "select",
        help: '"Best quality" picks a lower bitrate for you; the other modes aim for a size.',
        optionLabels: {
          best: "Best quality (recommended)",
          "target-size": "Target file size",
          percent: "Reduce by percentage",
          custom: "Custom bitrate",
        },
      })
      .default("best"),
    targetSizeMB: z
      .number()
      .min(0.1)
      .max(2000)
      .meta({
        label: "Target size",
        control: "number",
        unit: "MB",
        showWhen: { field: "mode", equals: "target-size" },
      })
      .default(10),
    percent: z
      .number()
      .int()
      .min(10)
      .max(90)
      .meta({
        label: "Reduce by",
        control: "slider",
        unit: "%",
        showWhen: { field: "mode", equals: "percent" },
      })
      .default(50),
    bitrate: z
      .enum(["64", "96", "128"])
      .meta({
        label: "Bitrate",
        control: "select",
        unit: "kbps",
        showWhen: { field: "mode", equals: "custom" },
      })
      .default("96"),
    channels: audioChannelsSelect.meta({
      showWhen: { field: "mode", equals: "custom" },
    }),
  }),
  defaults: {
    mode: "best",
    targetSizeMB: 10,
    percent: 50,
    bitrate: "96",
    channels: "keep",
  },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
  neverLarger: true,
});

import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out. `quality` maps to an explicit
 * target bitrate, capped against the source's own bitrate so an
 * already-efficiently-encoded source is never re-encoded bigger
 * (`src/lib/engines/mediabunny/bitrate.ts`'s `chooseVideoBitrateBps`,
 * ADR-0013's addendum); `maxHeight` is an optional resolution cap layered
 * on top (reuses the same preset vocabulary and
 * `resizeToVideoOptions`/`dimensionsForPreset` as `resize-video`, via the
 * adapter's `maxHeight` field) — downscaling is often the biggest lever on
 * file size for source video shot well above web resolution.
 *
 * `neverLarger: true` (see that field's doc comment on `ToolDefinition`) is
 * the safety net underneath the bitrate cap above: even a good-faith bitrate
 * estimate can be wrong (an odd container, no bitrate metadata and a bad
 * file-size/duration estimate), so `job-engine.ts`'s own size check still
 * has the final word and hands back the original file if the result isn't
 * actually smaller. Enforced in `job-engine.ts` rather than inside the
 * `mediabunny` adapter, same reason as `compress-audio`: a large output
 * here streams straight to OPFS instead of living in memory (ADR-0010).
 */
export default defineTool({
  slug: "compress-video",
  category: "video",
  title: "Compress Video",
  description:
    "Shrink a video's file size. Pick a quality and an optional maximum resolution.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "same",

  options: z.object({
    quality: z
      .enum(["low", "medium", "high"])
      .meta({ label: "Quality", control: "select" })
      .default("medium"),
    maxHeight: z
      .enum(["1080p", "720p", "480p", "none"])
      .meta({
        label: "Max resolution",
        control: "select",
        help: "Downscale if the source is taller than this",
      })
      .default("none"),
  }),
  defaults: { quality: "medium", maxHeight: "none" },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
  neverLarger: true,
});

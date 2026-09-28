import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out. `quality` maps to mediabunny's
 * `Quality` constants (`qualityForPreset` in `video.ts`); `maxHeight` is an
 * optional resolution cap layered on top (reuses the same preset
 * vocabulary and `resizeToVideoOptions`/`dimensionsForPreset` as
 * `resize-video`, via the adapter's `maxHeight` field) — downscaling is
 * often the biggest lever on file size for source video shot well above
 * web resolution.
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
});

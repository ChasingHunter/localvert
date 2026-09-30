import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Container conversion, one tool file per pair (SEO — see ADR-0010 and
 * `mp4-to-webm.ts`'s precedent). mediabunny's adapter always re-encodes here
 * (vp9-or-vp8/opus source -> avc/aac output — codec families never overlap
 * between these two containers, unlike a same-family remux), so `quality`
 * is a real, meaningful option, mapped to mediabunny's `Quality` constants
 * in `src/lib/engines/mediabunny/video.ts`'s `qualityForPreset`.
 */
export default defineTool({
  slug: "webm-to-mp4",
  category: "video",
  title: "WebM to MP4",
  description:
    "Convert WebM video to MP4, a format every device and editor supports.",

  accepts: ["webm"],
  produces: "mp4",

  options: z.object({
    quality: z
      .enum(["low", "medium", "high"])
      .meta({
        label: "Quality",
        control: "select",
        optionLabels: {
          low: "Low",
          medium: "Medium",
          high: "High",
        },
      })
      .default("medium"),
  }),
  defaults: { quality: "medium" },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
});

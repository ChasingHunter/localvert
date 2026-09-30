import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Container conversion — see `webm-to-mp4.ts`'s doc comment for the shared
 * shape. Same codec crossing as `mp4-to-webm.ts` (h264/aac -> vp9-or-vp8/
 * opus, always a real re-encode), just the other mov/mp4 source format;
 * kept as its own tool file rather than folded into `mp4-to-webm` for SEO
 * (a dedicated "mov to webm" landing page), matching the pattern this
 * whole batch of container tools follows.
 */
export default defineTool({
  slug: "mov-to-webm",
  category: "video",
  title: "MOV to WebM",
  description:
    "Convert QuickTime MOV to WebM: smaller, royalty-free, and plays on modern devices.",

  accepts: ["mov"],
  produces: "webm",

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

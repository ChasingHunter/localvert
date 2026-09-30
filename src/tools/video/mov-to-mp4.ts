import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Container conversion — see `webm-to-mp4.ts`'s doc comment for the shared
 * shape. mov -> mp4 is the one pair in this slice where mediabunny's
 * `Conversion` can remux without re-encoding: QuickTime and MP4 are both
 * ISOBMFF, and a mov's h264/aac tracks are already valid mp4 payloads, so
 * `Conversion` copies the encoded packets straight through whenever the
 * codecs already fit (see ADR-0010's "remux without re-encode" alternative,
 * closed here as mediabunny's own default `copy` behavior needs no extra
 * wiring). `quality` still exists for the case where the source isn't
 * h264/aac and a real transcode is required.
 */
export default defineTool({
  slug: "mov-to-mp4",
  category: "video",
  categoryRank: 2,
  title: "MOV to MP4",
  description:
    "Convert QuickTime MOV to MP4, a format every device and editor supports.",

  accepts: ["mov"],
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

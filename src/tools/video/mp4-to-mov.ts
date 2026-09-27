import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Container conversion — see `webm-to-mp4.ts`'s doc comment for the shared
 * shape. Like mov-to-mp4, this is usually a fast remux (both ISOBMFF,
 * h264/aac fits either container natively); mediabunny's `Conversion`
 * copies packets through without re-encoding whenever the codecs already
 * fit, only falling back to a real transcode (using `quality`) otherwise.
 */
export default defineTool({
  slug: "mp4-to-mov",
  category: "video",
  title: "MP4 to MOV",
  description:
    "Convert MP4 to QuickTime MOV — for Final Cut Pro and other Apple " +
    "editing tools. Free and private: runs in your browser, no upload.",

  accepts: ["mp4"],
  produces: "mov",

  options: z.object({
    quality: z
      .enum(["low", "medium", "high"])
      .meta({ label: "Quality", control: "select" })
      .default("medium"),
  }),
  defaults: { quality: "medium" },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
});

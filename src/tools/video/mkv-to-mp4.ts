import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Container conversion — see `webm-to-mp4.ts`'s doc comment for the shared
 * shape. `accepts: ["mkv"]` relies on `refineFormat` (`src/lib/registry/
 * formats.ts`) to upgrade a sniffed "webm" to "mkv" by extension, since mkv
 * and webm share the same EBML magic bytes byte-for-byte — see that
 * function's doc comment.
 */
export default defineTool({
  slug: "mkv-to-mp4",
  category: "video",
  title: "MKV to MP4",
  description:
    "Convert Matroska MKV video to MP4, a format every device and editor supports.",

  accepts: ["mkv"],
  produces: "mp4",

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

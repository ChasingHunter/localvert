import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Same ffmpeg route as `avi-to-mp4.ts` — WMV's codec (Windows Media Video,
 * often paired with WMA audio) isn't one WebCodecs decodes, so this
 * container reaches ffmpeg (ADR-0002) rather than the permissive mediabunny
 * path. See `avi-to-mp4.ts`'s doc comment and `docs/adr/0002-mit-license-gpl-isolation.md`.
 */
export default defineTool({
  slug: "wmv-to-mp4",
  category: "video",
  title: "WMV to MP4",
  description:
    "Convert legacy WMV video to MP4 — the format every device and editor " +
    "supports. Free and private: runs in your browser, no upload.",

  accepts: ["wmv"],
  produces: "mp4",

  options: z.object({}),
  defaults: {},

  pipeline: [{ op: "transcode", candidates: [{ engine: "ffmpeg" }] }],

  batch: true,
});

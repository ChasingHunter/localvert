import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The first tool to reach the ffmpeg engine (ADR-0002) — AVI's usual codecs
 * (mpeg4, mjpeg, DivX/Xvid; mp3/pcm audio) aren't ones WebCodecs (mediabunny's
 * path) decodes, so this container has no permissive-path route to mp4.
 * The ffmpeg engine itself is GPL-2.0-or-later, fetched on demand from R2 —
 * see `docs/adr/0002-mit-license-gpl-isolation.md` and `src/lib/engines/ffmpeg/`.
 */
export default defineTool({
  slug: "avi-to-mp4",
  category: "video",
  title: "AVI to MP4",
  description:
    "Convert legacy AVI video to MP4 — the format every device and editor " +
    "supports. Free and private: runs in your browser, no upload.",

  accepts: ["avi"],
  produces: "mp4",

  options: z.object({}),
  defaults: {},

  pipeline: [{ op: "transcode", candidates: [{ engine: "ffmpeg" }] }],

  batch: true,
});

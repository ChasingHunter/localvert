import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Same ffmpeg route as `wmv-to-mp4` — WMA's codec (wmav1/wmav2) isn't one
 * WebCodecs decodes, so this container reaches ffmpeg (ADR-0002, GPL
 * isolation) rather than the permissive mediabunny path. Unlike wmv, wma is
 * audio-only, so this tool's output is mp3, not mp4 — see
 * `src/lib/engines/ffmpeg/adapter.ts`'s `supports`/`runTranscode` for the
 * one-off branch that gives it. WMA and WMV share the ASF container's
 * header GUID byte-for-byte; a dropped file is told apart by its extension
 * (`src/lib/registry/formats.ts`'s `refineFormat`), the same
 * extension-assisted pattern as `raw`/`webm`/`ogg` elsewhere in that table.
 */
export default defineTool({
  slug: "wma-to-mp3",
  category: "audio",
  title: "WMA to MP3",
  description:
    "Convert legacy WMA audio to MP3, a format every device and player supports.",

  accepts: ["wma"],
  produces: "mp3",

  options: z.object({}),
  defaults: {},

  pipeline: [{ op: "transcode", candidates: [{ engine: "ffmpeg" }] }],

  batch: true,
});

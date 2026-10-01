import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * One ffmpeg run does both the audio extract and the mp3 encode (libmp3lame,
 * 192k), straight from the legacy container, rather than chaining through
 * mp4. ffmpeg (not mediabunny) because the codecs aren't ones WebCodecs
 * decodes — same route and GPL isolation as `wmv-to-mp4` (ADR-0002); see
 * `src/lib/engines/ffmpeg/adapter.ts`.
 */
export default defineTool({
  slug: "wmv-to-mp3",
  category: "audio",
  title: "WMV to MP3",
  description: "Pull the audio out of a WMV video as an MP3 file.",

  accepts: ["wmv"],
  produces: "mp3",

  options: z.object({}),
  defaults: {},

  pipeline: [{ op: "transcode", candidates: [{ engine: "ffmpeg" }] }],

  batch: true,
});

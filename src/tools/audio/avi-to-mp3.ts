import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * One ffmpeg run does both the audio extract and the mp3 encode (libmp3lame,
 * 192k), straight from the legacy container, rather than chaining through
 * mp4. ffmpeg (not mediabunny) because the codecs aren't ones WebCodecs
 * decodes — same route and GPL isolation as `avi-to-mp4` (ADR-0002); see
 * `src/lib/engines/ffmpeg/adapter.ts`.
 */
export default defineTool({
  slug: "avi-to-mp3",
  category: "audio",
  title: "AVI to MP3",
  description: "Pull the audio out of an AVI video as an MP3 file.",

  accepts: ["avi"],
  produces: "mp3",

  options: z.object({}),
  defaults: {},

  pipeline: [{ op: "transcode", candidates: [{ engine: "ffmpeg" }] }],

  batch: true,
});

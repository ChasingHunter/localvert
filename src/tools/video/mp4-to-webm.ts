import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0010: the first media tool on the mediabunny pipeline. `from`/`to` are
 * left unset on the pipeline step (unlike ADR-0007's `imagePipeline` tools)
 * so `job-engine.ts`'s `buildSteps` falls back to each file's own sniffed
 * format on the input side — this tool accepts both mp4 and mov, and a
 * fixed `from` could only ever name one of them. `mediabunny`'s adapter
 * checks the real per-file format in its own `supports()` regardless.
 *
 * No options yet: always re-encodes to VP9-or-VP8 video + Opus audio,
 * whichever the browser's WebCodecs can actually encode (probed in the
 * adapter). A quality/resolution option is future work once there's a
 * second media tool to share it with.
 */
export default defineTool({
  slug: "mp4-to-webm",
  category: "video",
  title: "MP4 to WebM",
  description:
    "Convert MP4 or MOV video to WebM: smaller, royalty-free, and plays on modern devices.",

  accepts: ["mp4", "mov"],
  produces: "webm",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      candidates: [{ engine: "mediabunny" }],
    },
  ],

  batch: true,
});

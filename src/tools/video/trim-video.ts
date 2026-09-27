import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out (`produces: "same"`, no pipeline
 * `from`/`to` — same pattern as `strip-exif.ts`). Cross-field validation
 * (`end` must be greater than `start`) can't live in this zod schema:
 * `defineTool`'s `S extends z.ZodObject` constraint rejects a `.refine()`-
 * wrapped `ZodEffects`, so it's done at run time in the mediabunny adapter
 * (`video.ts`'s `validateTrim`, unit-tested there) instead, which throws a
 * clear `EngineError` rather than silently producing a zero-or-negative-
 * length clip.
 */
export default defineTool({
  slug: "trim-video",
  category: "video",
  title: "Trim Video",
  description:
    "Cut a video down to a start and end time — free and private, runs " +
    "in your browser. Files never leave your device.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "same",

  options: z.object({
    start: z
      .number()
      .min(0)
      .meta({ label: "Start", control: "number", unit: "s" })
      .default(0),
    end: z
      .number()
      .positive()
      .meta({ label: "End", control: "number", unit: "s" }),
  }),
  defaults: { start: 0, end: 10 },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
});

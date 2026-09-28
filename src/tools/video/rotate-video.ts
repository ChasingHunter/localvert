import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out. `rotate` is a clockwise degree
 * pick, mapped 1:1 to mediabunny's `Rotation` (`0 | 90 | 180 | 270`) by
 * `video.ts`'s `rotationFor` — a string enum here (zod enums are
 * string-only) rather than a numeric one, converted back to a number in
 * the adapter before it reaches mediabunny.
 */
export default defineTool({
  slug: "rotate-video",
  category: "video",
  title: "Rotate Video",
  description: "Rotate a video 90, 180 or 270 degrees.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "same",

  options: z.object({
    rotate: z
      .enum(["90", "180", "270"])
      .meta({ label: "Rotate", control: "select", unit: "°" })
      .default("90"),
  }),
  defaults: { rotate: "90" },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
});

import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Phase 3c: replaces ADR-0002's ffmpeg GIF fallback with `gifenc` (MIT) —
 * see that ADR's dated mitigation note and `src/lib/engines/mediabunny/
 * gif.ts`'s doc comment for the encode itself. `from`/`to` are left unset on
 * the pipeline step for the same reason as `mp4-to-webm`: this tool accepts
 * three input formats, and a fixed `from` could only ever name one.
 *
 * `fps`/`width`/`colors` are fixed option sets rather than free numeric
 * fields — each maps to a `control: "select"` enum of strings (zod's `enum`
 * is string-only); the engine parses them back to numbers. `start`/
 * `duration` stay free numeric sliders since any in-range value is
 * meaningful for a trim point, unlike a color/resolution/framerate tier.
 */
export default defineTool({
  slug: "video-to-gif",
  category: "video",
  title: "Video to GIF",
  description:
    "Convert a video clip to an animated GIF — free and private, runs " +
    "entirely in your browser. Trim the range, pick frame rate, width and " +
    "colors.",

  accepts: ["mp4", "mov", "webm"],
  produces: "gif",

  options: z.object({
    start: z
      .number()
      .min(0)
      .meta({ label: "Start", control: "number", unit: "s" })
      .default(0),
    duration: z
      .number()
      .min(0.1)
      .max(30)
      .meta({ label: "Duration", control: "slider", unit: "s" })
      .default(5),
    fps: z
      .enum(["5", "10", "15", "20"])
      .meta({ label: "Frame rate", control: "select", unit: "fps" })
      .default("10"),
    width: z
      .enum(["240", "320", "480", "640"])
      .meta({ label: "Width", control: "select", unit: "px" })
      .default("480"),
    colors: z
      .enum(["64", "128", "256"])
      .meta({ label: "Colors", control: "select" })
      .default("256"),
    loop: z
      .boolean()
      .meta({ label: "Loop forever", control: "switch" })
      .default(true),
  }),
  defaults: {
    start: 0,
    duration: 5,
    fps: "10",
    width: "480",
    colors: "256",
    loop: true,
  },

  pipeline: [
    {
      op: "toGif",
      candidates: [{ engine: "mediabunny" }],
    },
  ],

  batch: true,
});

import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out. No user-facing option — the tool
 * always discards the audio track, so the schema carries a single hidden
 * always-true field for the adapter to read (`task.options.mute`) rather
 * than an empty `{}` schema, so `src/lib/engines/mediabunny/adapter.ts`
 * doesn't need a slug-based special case to know this is the mute tool.
 * With no audio track to encode, mediabunny copies the video track's
 * packets straight through whenever the container/codec pair doesn't force
 * a transcode — no re-encode needed just to drop audio.
 */
export default defineTool({
  slug: "mute-video",
  category: "video",
  title: "Mute Video",
  description:
    "Remove the audio track from a video — free and private, runs in " +
    "your browser. Files never leave your device.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "same",

  options: z.object({
    mute: z
      .literal(true)
      .meta({ label: "Mute", control: "hidden" })
      .default(true),
  }),
  defaults: { mute: true },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
});

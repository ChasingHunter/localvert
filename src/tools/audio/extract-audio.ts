import { z } from "zod";
import { defineTool } from "@/lib/registry";
import { audioBitrateSelect } from "../_shared-options";

/**
 * Phase 3b, the one audio tool with a runtime-selectable output container.
 * `from`/`to` are left unset on the pipeline step, same reasoning as
 * `mp4-to-webm`: this tool accepts mp4/mov/webm/mkv and `mediabunny`'s
 * adapter checks the real per-file format in its own `supports()`.
 *
 * `produces` stays a fixed `"mp3"` (the default `format`) even though the
 * real output can be m4a/wav/ogg/opus too — `ToolDefinition.produces` has no
 * way to express "depends on an option value". `outputName` below computes
 * the real extension from `opts.format`, and `src/lib/engines/mediabunny/
 * audio.ts`'s `chosenOutputFormat` reads the same option back out on the
 * engine side so the container actually written matches what was picked.
 * See that function's doc comment for the full mechanism.
 *
 * `bitrate` only applies to the lossy targets (mp3/m4a/ogg) — shown/hidden
 * via `showWhen` rather than removed from the schema, since a field that
 * becomes hidden keeps its value (`OptionsForm`'s rule), and dropping it
 * from the schema entirely would need a different options object per
 * `format` value, which `defineTool`'s single static `options` schema can't
 * express either.
 */
export default defineTool({
  slug: "extract-audio",
  category: "audio",
  categoryRank: 5,
  title: "Extract Audio",
  description:
    "Pull the audio track out of a video file as MP3, M4A, WAV, Ogg or Opus.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "mp3",
  // The picker's "mp4 to WAV" etc.: opens this tool with `format` preselected.
  producesAlso: [
    { format: "wav", presetOptions: { format: "wav" } },
    { format: "m4a", presetOptions: { format: "m4a" } },
    { format: "ogg", presetOptions: { format: "ogg" } },
  ],

  options: z.object({
    format: z
      .enum(["mp3", "m4a", "wav", "ogg", "opus"])
      .meta({
        label: "Output format",
        control: "select",
        optionLabels: {
          mp3: "MP3",
          m4a: "M4A",
          wav: "WAV",
          ogg: "Ogg",
          opus: "Opus",
        },
      })
      .default("mp3"),
    bitrate: audioBitrateSelect.meta({
      showWhen: { field: "format", equals: ["mp3", "m4a", "ogg", "opus"] },
    }),
  }),
  defaults: {
    format: "mp3",
    bitrate: "192",
  },

  outputName: (inputName, opts) => {
    const dot = inputName.lastIndexOf(".");
    const base = dot === -1 ? inputName : inputName.slice(0, dot);
    return `${base}.${opts.format}`;
  },

  pipeline: [
    {
      op: "transcode",
      candidates: [{ engine: "mediabunny" }],
    },
  ],

  batch: true,
});

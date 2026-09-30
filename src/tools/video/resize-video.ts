import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out. `preset` picks a common target
 * height (mediabunny derives width from the input's aspect ratio); the
 * `"custom"` preset reveals `width`/`height` via `showWhen` for an exact
 * size. Mapped to mediabunny's `ConversionVideoOptions` in
 * `src/lib/engines/mediabunny/video.ts`'s `resizeToVideoOptions` /
 * `dimensionsForPreset`.
 */
export default defineTool({
  slug: "resize-video",
  category: "video",
  title: "Resize Video",
  description: "Resize a video to a common resolution or an exact size.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "same",

  options: z.object({
    preset: z
      .enum(["1080p", "720p", "480p", "custom"])
      .meta({
        label: "Size",
        control: "select",
        optionLabels: {
          "1080p": "1080p",
          "720p": "720p",
          "480p": "480p",
          custom: "Custom size",
        },
      })
      .default("720p"),
    width: z
      .number()
      .int()
      .positive()
      .meta({
        label: "Width",
        control: "number",
        unit: "px",
        showWhen: { field: "preset", equals: "custom" },
      })
      .optional(),
    height: z
      .number()
      .int()
      .positive()
      .meta({
        label: "Height",
        control: "number",
        unit: "px",
        showWhen: { field: "preset", equals: "custom" },
      })
      .optional(),
    fit: z
      .enum(["contain", "cover", "fill"])
      .meta({
        label: "Fit",
        control: "select",
        optionLabels: {
          contain: "Fit inside",
          cover: "Fill and crop",
          fill: "Stretch",
        },
        help: "How width and height combine when both are set",
        showWhen: { field: "preset", equals: "custom" },
      })
      .default("contain"),
  }),
  defaults: { preset: "720p", fit: "contain" },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
});

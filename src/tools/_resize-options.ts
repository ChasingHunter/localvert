import { z } from "zod";

/**
 * The option fields shared by resize-image-jpg/png/webp. A flat file directly
 * under `src/tools/` for the same reason as `_shared-options.ts` (see its doc
 * comment: `scanTools` only reads files inside category directories).
 *
 * "By percentage" is the default so dropping a photo does something useful
 * straight away (shrinks it to half). The width/height/fit/upscale fields only
 * show in "Exact size" mode. The engines read `resizeBy`/`percent` directly
 * (`src/lib/engines/shared/resize-box.ts`).
 */
export const resizeFields = {
  resizeBy: z
    .enum(["percent", "exact"])
    .meta({
      label: "Resize",
      control: "select",
      optionLabels: { percent: "By percentage", exact: "Exact size" },
    })
    .default("percent"),
  percent: z
    .number()
    .int()
    .min(10)
    .max(100)
    .meta({
      label: "Size",
      control: "slider",
      unit: "%",
      help: "Percent of the original width and height",
      showWhen: { field: "resizeBy", equals: "percent" },
    })
    .default(50),
  width: z
    .number()
    .int()
    .positive()
    .meta({
      label: "Width",
      control: "number",
      unit: "px",
      showWhen: { field: "resizeBy", equals: "exact" },
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
      showWhen: { field: "resizeBy", equals: "exact" },
    })
    .optional(),
  fit: z
    .enum(["contain", "cover", "fill"])
    .meta({
      label: "Fit",
      control: "select",
      help: "How width and height combine when both are set",
      optionLabels: {
        contain: "Fit inside",
        cover: "Fill and crop",
        fill: "Stretch",
      },
      showWhen: { field: "resizeBy", equals: "exact" },
    })
    .default("contain"),
  allowUpscale: z
    .boolean()
    .meta({
      label: "Allow upscale",
      control: "switch",
      showWhen: { field: "resizeBy", equals: "exact" },
    })
    .default(false),
};

export const resizeDefaults = {
  resizeBy: "percent",
  percent: 50,
  fit: "contain",
  allowUpscale: false,
} as const;

/**
 * "Exact size" needs a width or a height. Both blank means there is nothing
 * to do, so the file waits for one instead of passing through untouched.
 */
export function resizeReady(options: Readonly<Record<string, unknown>>) {
  if (options.resizeBy !== "exact") return true;
  const has = (v: unknown) => typeof v === "number" && v > 0;
  return has(options.width) || has(options.height);
}

export const resizeReadiness = {
  isReady: resizeReady,
  hint: "Enter a width or a height to resize.",
};

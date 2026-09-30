import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Stamps `text` across every selected page — the `pdf-lib` engine's
 * `runWatermark`. `text` is required (same pattern as `protect-pdf`'s
 * `password` / `delete-pdf-pages`'s `pages`: a real, empty-default string
 * field, with `required: true` gating the run action rather than a
 * `.min(1)` schema constraint, since `defaults` has to satisfy `options`
 * and there's no sensible default watermark string). Helvetica (the only
 * font this op embeds) only encodes WinAnsi text — `runWatermark` checks
 * every character up front and fails with a clear message naming whichever
 * ones it can't render, instead of letting pdf-lib silently swap them for
 * "?". `pages` is the shared page-range spec (`""` = every page), same
 * dialect as `rotate-pdf`'s own `pages` field.
 */
export default defineTool({
  slug: "watermark-pdf",
  category: "pdf",
  title: "Watermark PDF",
  description: "Stamp a text watermark across every page of a PDF.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    text: z.string().meta({
      label: "Watermark text",
      control: "text",
      required: true,
      help: "Only Latin/Western characters are supported (Helvetica's WinAnsi encoding).",
    }),
    fontSize: z
      .number()
      .min(6)
      .max(400)
      .meta({ label: "Font size", control: "number", unit: "pt" }),
    opacity: z
      .number()
      .min(0.05)
      .max(1)
      .meta({ label: "Opacity", control: "slider", step: 0.05 }),
    angle: z.enum(["diagonal", "horizontal"]).meta({
      label: "Angle",
      control: "select",
      optionLabels: {
        diagonal: "Diagonal",
        horizontal: "Horizontal",
      },
    }),
    color: z.enum(["gray", "red", "blue", "black"]).meta({
      label: "Color",
      control: "select",
      optionLabels: {
        gray: "Gray",
        red: "Red",
        blue: "Blue",
        black: "Black",
      },
    }),
    position: z.enum(["center", "top", "bottom"]).meta({
      label: "Position",
      control: "select",
      optionLabels: {
        center: "Center",
        top: "Top",
        bottom: "Bottom",
      },
    }),
    pages: z.string().meta({
      label: "Pages",
      control: "text",
      help: 'Which pages to watermark, e.g. "1-3, 5". Leave blank for every page.',
    }),
  }),
  defaults: {
    text: "",
    fontSize: 48,
    opacity: 0.25,
    angle: "diagonal",
    color: "gray",
    position: "center",
    pages: "",
  },

  pipeline: [
    {
      op: "watermark",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});

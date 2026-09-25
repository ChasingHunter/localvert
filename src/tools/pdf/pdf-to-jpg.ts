import { z } from "zod";
import { defineTool } from "@/lib/registry";
import { jpgOptions } from "../_shared-options";

/**
 * ADR-0008: arity "one-to-many" — one dropped PDF becomes one job that
 * produces N output files, one JPG per selected page, listed on its job
 * card with per-file downloads plus "Download all (.zip)". Submits on drop,
 * same as `split-pdf` (`ToolRunner` only special-cases "many-to-one"'s
 * submit flow).
 *
 * `pages` is the shared page-range spec (`""` = every page), same dialect
 * as every other PDF tool's page field. `dpi` becomes the `pdfjs` engine's
 * render scale (`scale = dpi / 72`); `quality` is `jpgOptions`'s own field
 * (`../_shared-options.ts`), not the whole `jpgOptions` object — a rendered
 * page always gets a plain white background (`pdfjs`'s own
 * `render({background: "#ffffff"})`, since a PDF page has no independent
 * notion of its own transparency), so there's no `background` knob to
 * expose the way an image-decode step has.
 */
export default defineTool({
  slug: "pdf-to-jpg",
  category: "pdf",
  title: "PDF to JPG",
  description:
    "Convert PDF to JPG — every page as an image, privately in your " +
    "browser. Free and private: choose a page range and resolution, no upload.",

  accepts: ["pdf"],
  produces: "jpg",

  options: z.object({
    pages: z
      .string()
      .meta({
        label: "Pages",
        control: "text",
        help: "e.g. 1-3, 5 — empty for all",
      })
      .default(""),
    dpi: z
      .number()
      .int()
      .min(72)
      .max(300)
      .meta({ label: "Resolution", control: "slider", unit: "dpi", step: 1 })
      .default(150),
    quality: jpgOptions.shape.quality,
  }),
  defaults: { pages: "", dpi: 150, quality: 0.85 },

  pipeline: [
    {
      op: "render",
      from: "pdf",
      to: "jpg",
      candidates: [{ engine: "pdfjs" }],
    },
  ],

  batch: false,
  arity: "one-to-many",
});

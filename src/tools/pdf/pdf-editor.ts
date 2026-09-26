import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0009: `kind: "app"` — this tool renders its own component
 * (`src/components/editor/pdf-editor-app.tsx`) instead of going through the
 * job pipeline's dropzone/job-list. `pipeline`/`batch` are required by
 * `ToolDefinition` but never dispatched to for an app-mode tool; the single
 * placeholder step below exists only to satisfy `defineTool`'s "at least one
 * step, unconditional last candidate" check.
 */
export default defineTool({
  slug: "pdf-editor",
  category: "pdf",
  title:
    "PDF Editor — annotate, highlight, draw and add text to PDFs, privately in your browser",
  description:
    "Open a PDF, highlight, underline, draw, add text and stamps, then " +
    "export — all in your browser, nothing uploaded.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "render",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: false,

  kind: "app",
  app: () =>
    import("@/components/editor/pdf-editor-app").then((mod) => ({
      default: mod.PdfEditorApp,
    })),
});

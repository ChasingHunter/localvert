import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0009: `kind: "app"` — this tool renders its own component
 * (`src/components/editor/pdf-editor-app.tsx`) instead of going through the
 * job pipeline's dropzone/job-list. `pipeline`/`batch` are required by
 * `ToolDefinition` but never dispatched to for an app-mode tool; the single
 * placeholder step below exists only to satisfy `defineTool`'s "at least one
 * step, unconditional last candidate" check.
 *
 * `app: "pdf-editor"` names the component by id rather than importing it —
 * this file is reachable from every server-rendered page through the
 * `src/tools/index.ts` barrel, so an `import()` of the (client) editor
 * component here would register it as a client reference for every page,
 * not just this tool's own. See `ToolDefinition.app`'s doc comment and
 * `src/components/app-registry.tsx`, the one module allowed to import it.
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
  app: "pdf-editor",
});

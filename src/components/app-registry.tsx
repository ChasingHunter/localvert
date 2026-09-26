"use client";

import dynamicImport from "next/dynamic";
import type { ComponentType } from "react";
import type { AppId } from "@/lib/registry";

/**
 * CLIENT COMPONENT — the one place an `AppId` resolves to an actual
 * component. This is deliberately the only module in the app that imports an
 * app-mode tool's UI: `src/tools/**` (server-reachable via the `src/tools`
 * barrel) names its app by id only (see `ToolDefinition.app`'s doc comment),
 * so nothing pulls `@embedpdf`/PDFium into a page that doesn't render the
 * editor.
 *
 * Each entry is a module-scope `next/dynamic()` const, same as
 * `ToolRunner`'s `OptionsForm`/`CropEditor` — confirmed (`docs/editor/
 * EMBEDPDF_NOTES.md`, "E1b Unit 1 findings") to code-split correctly: absent
 * from every page that doesn't render it. `ssr: false` because an app-mode
 * tool's UI (worker sessions, wasm) never renders on the server.
 */
const PdfEditorApp = dynamicImport(
  () =>
    import("@/components/editor/pdf-editor-app").then((mod) => ({
      default: mod.PdfEditorApp,
    })),
  { ssr: false },
);

export const APP_COMPONENTS: Record<AppId, ComponentType> = {
  "pdf-editor": PdfEditorApp,
};

"use client";

import dynamicImport from "next/dynamic";

interface AppToolProps {
  slug: string;
}

/**
 * CLIENT COMPONENT. The `kind: "app"` counterpart to `ToolRunner` — renders
 * exactly one app-mode tool's own component. No dropzone, no job list, no
 * options form here — an app-mode tool owns its entire UI. See ADR-0009 and
 * `ToolDefinition.kind`.
 *
 * `PdfEditorApp` below is a module-scope `next/dynamic()` const referenced
 * directly in JSX — the exact same pattern as `ToolRunner`'s
 * `OptionsForm`/`CropEditor` (confirmed there to code-split correctly: their
 * chunks are absent from every page that doesn't render them). This file
 * originally resolved the component generically, through
 * `TOOL_LOADERS[slug]().then(tool => tool.app())` inside a per-render
 * `dynamic()` call keyed by a `Record` lookup — that measured as landing in
 * EVERY page's first load regardless of slug (up to 299 KB gz of the 300 KB
 * budget on a plain image-conversion page that never touches the editor,
 * confirmed again even after moving the `dynamic()` call to module scope
 * behind a `Record<string, ComponentType>` map). Next's dynamic-import
 * analysis needs the component referenced as a directly-named JSX tag bound
 * to its own `const X = dynamic(...)`, not resolved through a computed
 * lookup — otherwise it falls back to bundling the chunk into the
 * app-wide-shared bundle instead of splitting it per page. See
 * `docs/editor/EMBEDPDF_NOTES.md` and the `@embedpdf`/`localvert-engine:`
 * checks in `scripts/check-sizes.ts`, which fail the build if this
 * regresses.
 *
 * Adding a second `kind: "app"` tool needs its own `const X = dynamic(...)`
 * here, referenced the same direct way — there's no codegen for app-mode
 * tools yet (ADR-0009 calls that kind's tooling still-evolving), so this
 * stays a small hand-written `if`/`else if` chain rather than a generic
 * slug -> component map.
 */
const PdfEditorApp = dynamicImport(
  () =>
    import("@/components/editor/pdf-editor-app").then((mod) => ({
      default: mod.PdfEditorApp,
    })),
  {
    ssr: false,
    loading: () => <p className="text-sm text-ink-muted">Loading editor…</p>,
  },
);

export function AppTool({ slug }: AppToolProps) {
  if (slug === "pdf-editor") {
    return <PdfEditorApp />;
  }
  return <p className="text-sm text-danger">Unknown tool "{slug}".</p>;
}

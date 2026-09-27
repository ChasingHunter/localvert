/**
 * Per-tool default annotation colour (owner-reported fix, 2026-09-27).
 *
 * `pdf-editor-app.tsx` used to hold ONE shared `color` `useState`, seeded
 * from the Highlight tool's default (`#ffd400`) and applied unconditionally
 * to every tool via `buildToolContext`. That meant switching to "Add text"
 * (FreeText) still pushed yellow into `fontColor` -- the colour picker never
 * "did nothing" (as reported), it was always writing, just always to the
 * same shared value every tool shared. This module gives each tool its own
 * remembered default instead, keyed by tool id, so picking a colour for one
 * tool never bleeds into another's next annotation.
 *
 * Kept pure and DOM/plugin-free so the map update is unit-testable on its
 * own -- the actual wiring (reading the active tool, calling
 * `setToolDefaults`) stays in `pdf-editor-app.tsx`.
 */

/** One row per tool id this editor's toolbar exposes a colour picker for. */
export type ToolColorMap = Readonly<Record<string, string>>;

/** Every color-bearing tool's starting default. FreeText defaults to black
 * (matching `@embedpdf/plugin-annotation`'s own FreeText tool defaults --
 * see its `default-tools` module), Highlight keeps the plugin's own yellow,
 * and every stroke/shape tool gets a plain black stroke -- a sensible,
 * visible default distinct from both of the above. */
export const DEFAULT_TOOL_COLORS: ToolColorMap = {
  highlight: "#ffd400",
  underline: "#000000",
  strikeout: "#000000",
  squiggly: "#000000",
  ink: "#000000",
  square: "#000000",
  circle: "#000000",
  lineArrow: "#000000",
  freeText: "#000000",
};

/** The fallback used for a tool id this map has no row for (e.g. `null`,
 * meaning no tool is active, or `stamp`, which has no colour at all). Never
 * actually applied to an annotation -- callers only write a tool's own
 * colour back through `setToolDefaults`/`updateAnnotation` when the active
 * tool or selected annotation is one of the ids above. */
const FALLBACK_COLOR = "#000000";

/** The colour to show in the picker for `toolId` -- its own remembered
 * default, or the fallback if `toolId` is `null` or unrecognized. */
export function colorForTool(
  colors: ToolColorMap,
  toolId: string | null,
): string {
  if (!toolId) return FALLBACK_COLOR;
  return colors[toolId] ?? FALLBACK_COLOR;
}

/** Returns a new map with `toolId`'s remembered colour set to `color`,
 * leaving every other tool's default untouched. */
export function setToolColor(
  colors: ToolColorMap,
  toolId: string,
  color: string,
): ToolColorMap {
  return { ...colors, [toolId]: color };
}

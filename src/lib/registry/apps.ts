/**
 * The closed set of `kind: "app"` tool ids. A tool definition names its app
 * by one of these ids instead of importing the component itself — see the
 * doc comment on `ToolDefinition.app` and `src/components/app-registry.tsx`
 * (the one place these ids resolve to an actual component, and the only
 * module allowed to import an app-mode tool's UI).
 *
 * Adding a second app-mode tool means adding its id here AND a matching
 * entry in `APP_COMPONENTS` (`app-registry.tsx`) — `defineTool` checks a
 * tool's `app` against this list, so a typo or a missing registration fails
 * loudly at definition time rather than 404ing on the rendered page.
 */
export const APP_IDS = ["pdf-editor"] as const;

export type AppId = (typeof APP_IDS)[number];

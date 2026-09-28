"use client";

import { APP_COMPONENTS } from "@/components/app-registry";
import { PrivacyNote } from "@/components/privacy-note";
import type { AppId } from "@/lib/registry";

interface AppToolProps {
  appId: AppId;
}

/**
 * CLIENT COMPONENT. The `kind: "app"` counterpart to `ToolRunner` — renders
 * exactly one app-mode tool's own component. No dropzone, no job list, no
 * options form here — an app-mode tool owns its entire UI. See ADR-0009 and
 * `ToolDefinition.kind`.
 *
 * Takes the tool's `appId` as a prop (the server page already has the tool
 * loaded via `TOOLS_BY_SLUG`, so it passes `tool.app` straight through)
 * rather than re-resolving a slug itself — the actual component lookup lives
 * in `src/components/app-registry.tsx`, the only client module allowed to
 * import an app-mode tool's UI. See that file's doc comment for why a tool
 * definition names its app by id instead of importing the component.
 *
 * The one `PrivacyNote` an app-mode tool page gets (ADR-0016's "one privacy
 * line per tool page" — `ToolRunner` renders its own copy next to its
 * dropzone; an app tool has no dropzone of its own, so this wrapper is the
 * only place left to say it once, near the top of the tool's own UI).
 */
export function AppTool({ appId }: AppToolProps) {
  const Component = APP_COMPONENTS[appId];
  return (
    <div className="flex flex-col gap-4">
      <PrivacyNote size="sm" />
      <Component />
    </div>
  );
}

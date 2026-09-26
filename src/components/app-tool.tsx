"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import type { ToolDefinition } from "@/lib/registry/types";
import { TOOL_LOADERS } from "@/tools/loaders";

interface AppToolProps {
  slug: string;
}

/**
 * CLIENT COMPONENT. The `kind: "app"` counterpart to `ToolRunner` — loads
 * exactly one tool via `TOOL_LOADERS[slug]` (never the `TOOLS` barrel, same
 * reasoning as `ToolRunner`), then lazily loads and renders that tool's own
 * `app` component. No dropzone, no job list, no options form here — an
 * app-mode tool owns its entire UI. See ADR-0009 and `ToolDefinition.kind`.
 */
export function AppTool({ slug }: AppToolProps) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = (
      TOOL_LOADERS as Record<
        string,
        (() => Promise<{ default: ToolDefinition }>) | undefined
      >
    )[slug];
    if (!loader) {
      setError(`Unknown tool "${slug}".`);
      return;
    }
    loader()
      .then((mod) => {
        if (cancelled) return;
        const tool = mod.default;
        if (!tool.app) {
          setError(`Tool "${slug}" has kind "app" but no app loader.`);
          return;
        }
        return tool.app();
      })
      .then((appMod) => {
        if (cancelled || !appMod) return;
        setComponent(() => appMod.default);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!Component) {
    return <p className="text-sm text-ink-muted">Loading editor…</p>;
  }
  return <Component />;
}

import Link from "next/link";
import { FORMATS } from "@/lib/registry/formats";
import type { ToolDefinition } from "@/lib/registry/types";

interface ToolCardProps {
  tool: ToolDefinition;
}

/**
 * SERVER COMPONENT, no client JS. One tool, as a card: title, a short
 * description, and a from→to badge built from `FORMATS` labels — used on
 * the home page, category pages and the tool page's "Related tools".
 */
export function ToolCard({ tool }: ToolCardProps) {
  const from = tool.accepts.map((format) => FORMATS[format].label).join("/");
  // `produces: "same"` (e.g. strip-exif) has no fixed output format — see
  // ToolDefinition.produces's doc comment in src/lib/registry/types.ts.
  const to =
    tool.produces === "same" ? "same format" : FORMATS[tool.produces].label;

  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 outline-none transition-colors hover:bg-canvas focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <span className="text-sm font-medium text-ink">{tool.title}</span>
      <span className="line-clamp-2 text-xs text-ink-muted">
        {tool.description}
      </span>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-muted">
        {from} → {to}
      </span>
    </Link>
  );
}

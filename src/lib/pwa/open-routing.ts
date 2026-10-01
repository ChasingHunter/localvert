import type { FormatId } from "@/lib/registry/formats";
import { CATALOG } from "@/tools/catalog";

/** Where `/open` sends files it was handed by the OS or the share sheet. */
export type OpenRoute = { kind: "tool"; slug: string } | { kind: "home" };

/**
 * ADR-0018: picks the landing page for files that were opened from outside
 * the app. If exactly one tool (apps like the PDF editor don't count, same
 * rule as the pickers) accepts every one of `formats`, go straight to it.
 * Anything else, including the common case of a format that dozens of tools
 * accept, goes to the home converter with the files staged, where the user
 * picks the target. Pure so it is unit-testable without a browser.
 */
export function routeForFormats(formats: readonly FormatId[]): OpenRoute {
  const wanted = [...new Set(formats)];
  if (wanted.length === 0) return { kind: "home" };
  const matches = CATALOG.filter(
    (tool) =>
      tool.kind !== "app" && wanted.every((f) => tool.accepts.includes(f)),
  );
  const only = matches.length === 1 ? matches[0] : undefined;
  return only ? { kind: "tool", slug: only.slug } : { kind: "home" };
}

/** The live-region text while files are being handed off. */
export function describeOpening(count: number): string {
  return `Opening ${count} file${count === 1 ? "" : "s"}…`;
}

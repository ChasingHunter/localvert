/**
 * Header search: pure ranking over the generated tool catalog and the
 * format table. No React, no DOM, so it unit-tests without either and the
 * header only pays for it when search is opened (it is imported by the
 * lazy `header-search-panel.tsx` chunk, never by the header itself).
 *
 * Tiers, best first:
 * 0. the query is the tool's whole title ("compress pdf")
 * 1. the title starts with the query ("heic" -> "HEIC to JPG")
 * 2. the query is, or starts, a format name, extension or alias of a format
 *    the tool reads or writes ("iphone photo" -> the HEIC tools)
 * 3. the query (or every word of it) appears somewhere in the title or those
 *    format names ("pdf compress" -> "Compress PDF")
 * Ties break on popularity (`rank`, then `categoryRank`), then title.
 */

import type { Category } from "@/lib/registry/categories";
import type { FormatId, FormatSpec } from "@/lib/registry/formats";

export interface SearchableTool {
  slug: string;
  title: string;
  category: Category;
  accepts: readonly FormatId[];
  produces: FormatId | "same";
  rank?: number;
  categoryRank?: number;
}

export interface SearchEntry {
  slug: string;
  title: string;
  category: Category;
  /** Lowercased title. */
  lowerTitle: string;
  /** Lowercased format labels, extensions and aliases, deduplicated. */
  terms: readonly string[];
  /** Lower is more popular; `Infinity` when the tool is not featured. */
  popularity: number;
}

export const MAX_RESULTS = 10;

export function buildSearchIndex(
  tools: readonly SearchableTool[],
  formats: Readonly<Record<string, FormatSpec>>,
): SearchEntry[] {
  return tools.map((tool) => {
    const ids: string[] = [...tool.accepts];
    if (tool.produces !== "same") ids.push(tool.produces);
    const terms = new Set<string>();
    for (const id of ids) {
      const spec = formats[id];
      if (!spec) continue;
      terms.add(spec.label.toLowerCase());
      for (const ext of spec.ext) terms.add(ext.toLowerCase());
      for (const alias of spec.aliases ?? []) terms.add(alias.toLowerCase());
    }
    return {
      slug: tool.slug,
      title: tool.title,
      category: tool.category,
      lowerTitle: tool.title.toLowerCase(),
      terms: [...terms],
      popularity:
        tool.rank !== undefined
          ? tool.rank
          : tool.categoryRank !== undefined
            ? 100 + tool.categoryRank
            : Number.POSITIVE_INFINITY,
    };
  });
}

function tierOf(entry: SearchEntry, q: string, words: string[]): number | null {
  if (entry.lowerTitle === q) return 0;
  if (entry.lowerTitle.startsWith(q)) return 1;
  if (entry.terms.some((t) => t === q || t.startsWith(q))) return 2;
  if (entry.lowerTitle.includes(q) || entry.terms.some((t) => t.includes(q))) {
    return 3;
  }
  const haystack = `${entry.lowerTitle} ${entry.terms.join(" ")}`;
  return words.length > 1 && words.every((w) => haystack.includes(w))
    ? 3
    : null;
}

/** Up to `limit` matching entries, best first. Empty query -> no results. */
export function searchTools(
  index: readonly SearchEntry[],
  query: string,
  limit = MAX_RESULTS,
): SearchEntry[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q === "") return [];
  const words = q.split(" ");

  const scored: { entry: SearchEntry; tier: number }[] = [];
  for (const entry of index) {
    const tier = tierOf(entry, q, words);
    if (tier !== null) scored.push({ entry, tier });
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      compareNumbers(a.entry.popularity, b.entry.popularity) ||
      a.entry.title.localeCompare(b.entry.title),
  );
  return scored.slice(0, limit).map((s) => s.entry);
}

// `Infinity - Infinity` is NaN, so compare explicitly.
function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

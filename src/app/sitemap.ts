import type { MetadataRoute } from "next";
import {
  categoriesWithTools,
  groupToolsByCategory,
} from "@/components/tool-groups";
import { CATEGORIES } from "@/lib/registry";
import { SITE_URL } from "@/lib/site";
import { TOOLS } from "@/tools";

// `output: "export"` has no server to render this on request, so it has to
// be emitted at build time like every other route (invariant 4).
export const dynamic = "force-static";

/**
 * Home, every category page that actually has a tool, and every tool page —
 * the same set of routes `/[category]/page.tsx` and `/tools/[slug]/page.tsx`
 * generate, built from the same `groupToolsByCategory`/`categoriesWithTools`
 * helpers those pages use, so this can't drift from what's actually routable.
 * `/offline` is a fallback page, not content, and is excluded (it's also
 * marked `robots: { index: false }`). No `lastModified` — we don't track a
 * trustworthy per-page date, and an invented one is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const byCategory = groupToolsByCategory(TOOLS);
  const categories = categoriesWithTools(CATEGORIES, byCategory);

  return [
    { url: `${SITE_URL}/` },
    ...categories.map((category) => ({ url: `${SITE_URL}/${category}` })),
    ...TOOLS.map((tool) => ({ url: `${SITE_URL}/tools/${tool.slug}` })),
  ];
}

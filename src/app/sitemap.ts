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
 * Hand-authored routes that don't come out of the registry: the positioning
 * pages added for v0.4.0 (docs/ROADMAP.md's "Before cutting v0.4.0"). Each
 * one is a plain static page under `src/app/`, listed here by hand since
 * there's no generated catalog of "pages that aren't tools or categories".
 */
const STATIC_PAGES = [
  "/compress",
  "/privacy",
  "/vs/ilovepdf",
  "/vs/smallpdf",
  "/vs/vert",
] as const;

/**
 * Home, every category page that actually has a tool, every tool page, and
 * the hand-authored pages above. The category/tool set is built from the
 * same `groupToolsByCategory`/`categoriesWithTools` helpers `/[category]/
 * page.tsx` and `/tools/[slug]/page.tsx` use, so this can't drift from
 * what's actually routable — this includes `/pdf`, which is a real category
 * with tools even though it's served by its own hub page, not the generic
 * `[category]` layout (see that file's `generateStaticParams`).
 * `/offline` is a fallback page, not content, and is excluded (it's also
 * marked `robots: { index: false }`). No `lastModified` — we don't track a
 * trustworthy per-page date, and an invented one is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const byCategory = groupToolsByCategory(TOOLS);
  const categories = categoriesWithTools(CATEGORIES, byCategory);

  return [
    { url: `${SITE_URL}/` },
    ...STATIC_PAGES.map((path) => ({ url: `${SITE_URL}${path}` })),
    ...categories.map((category) => ({ url: `${SITE_URL}/${category}` })),
    ...TOOLS.map((tool) => ({ url: `${SITE_URL}/tools/${tool.slug}` })),
  ];
}

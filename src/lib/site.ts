/**
 * Single source of truth for the site's public origin — used to build
 * absolute canonical URLs, Open Graph URLs and the sitemap/robots files.
 * Changing domains later means editing this one line (plus setting up a
 * redirect from the old origin). No trailing slash.
 */
export const SITE_URL = "https://localvert.dpdns.org";

/**
 * The Open Graph fields every page shares (`siteName`, `type`) plus the
 * page's own absolute-relative `url`. Next merges `metadata.openGraph`
 * shallowly, so a page-level `openGraph` object replaces the layout's
 * entirely rather than merging into it — this helper exists so every page
 * that needs its own `openGraph.url` (for the correct `og:url`) doesn't
 * have to re-type `siteName`/`type` too.
 */
export function openGraph(path: string) {
  return { siteName: "Localvert", type: "website" as const, url: path };
}

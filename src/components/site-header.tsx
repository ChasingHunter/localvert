import Link from "next/link";
import { CompressMenu } from "@/components/compress-menu";
import { HeaderSearch } from "@/components/header-search";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  categoriesWithTools,
  groupToolsByCategory,
} from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import { TOOLS } from "@/tools";

const NAV_LINK =
  "shrink-0 rounded-sm text-sm font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/**
 * SERVER COMPONENT, no client JS of its own — see `PageShell`'s doc comment
 * for why this isn't in the root layout. `ThemeToggle`, `HeaderSearch` and
 * `CompressMenu` are the client islands it renders (ADR-0016). Nav only lists a category once it has a
 * registered tool, same rule the home page and category pages use (via
 * `categoriesWithTools`), so an empty category never gets a dead link.
 */
export function SiteHeader() {
  const byCategory = groupToolsByCategory(TOOLS);
  const navCategories = categoriesWithTools(CATEGORIES, byCategory);
  const compressors = TOOLS.filter((tool) =>
    tool.slug.startsWith("compress-"),
  ).map(({ slug, title }) => ({ slug, title }));

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-3 lg:px-12">
        {/*
         * `sm:contents` folds the wordmark + search/toggle cluster back into
         * the outer flex row at the `sm` breakpoint, so the header reads as
         * one row (wordmark, nav, search + toggle) on desktop while staying a real
         * two-row block (wordmark + cluster, then nav) below it (ADR-0016's
         * design review: mobile can't wrap the nav onto 2-3 lines).
         */}
        <div className="flex items-center justify-between gap-4 sm:contents">
          <Link
            href="/"
            className="rounded-sm font-display text-xl font-medium tracking-tight text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Localvert
          </Link>
          <div className="flex items-center gap-2 sm:order-3">
            <HeaderSearch />
            <ThemeToggle />
          </div>
        </div>

        <nav
          aria-label="Main"
          className="flex gap-x-5 overflow-x-auto pb-0.5 sm:order-2 sm:flex-wrap sm:gap-y-2 sm:overflow-visible sm:pb-0"
        >
          <Link href="/#converter" className={NAV_LINK}>
            Convert
          </Link>
          <CompressMenu tools={compressors} />
          {navCategories.map((category) => (
            <Link key={category} href={`/${category}`} className={NAV_LINK}>
              {CATEGORY_META[category].label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

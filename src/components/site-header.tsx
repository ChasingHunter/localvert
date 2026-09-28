import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  categoriesWithTools,
  groupToolsByCategory,
} from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * SERVER COMPONENT, no client JS of its own — see `PageShell`'s doc comment
 * for why this isn't in the root layout. `ThemeToggle` is the one client
 * island it renders (ADR-0016). Nav only lists a category once it has a
 * registered tool, same rule the home page and category pages use (via
 * `categoriesWithTools`), so an empty category never gets a dead link.
 */
export function SiteHeader() {
  const byCategory = groupToolsByCategory(TOOLS);
  const navCategories = categoriesWithTools(CATEGORIES, byCategory);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4 lg:px-12">
        <Link
          href="/"
          className="rounded-sm font-display text-xl font-medium tracking-tight text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Localvert
        </Link>

        <nav aria-label="Categories" className="flex flex-wrap gap-x-5 gap-y-2">
          {navCategories.map((category) => (
            <Link
              key={category}
              href={`/${category}`}
              className="rounded-sm text-sm font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {CATEGORY_META[category].label}
            </Link>
          ))}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}

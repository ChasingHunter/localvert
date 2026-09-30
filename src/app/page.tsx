import Link from "next/link";
import { CATEGORY_TINT_BG } from "@/components/category-tint";
import { Converter } from "@/components/converter/converter";
import { PageShell } from "@/components/page-shell";
import { groupToolsByCategory, shortToolLabel } from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * SERVER COMPONENT, no client JS except the `Converter` island it renders
 * (ADR-0015, styled here as ADR-0016's hero sentence). Category sections are
 * derived from the registry, so a new tool file shows up here automatically
 * on its next `pnpm gen` (docs/ADDING_A_TOOL.md).
 *
 * Accessible-heading structure for the hero (ADR-0016 asked for this to be
 * spelled out): the sentence "Convert my [From] into [To]" has two live
 * form controls inside it, and form controls can't go inside an `<h1>`
 * element. Rather than hide either the heading or the controls from
 * assistive tech, this page uses two separate, both-visible pieces instead:
 * an `<h1>` that states the page's purpose in plain language (for landmark
 * navigation and anyone skimming headings), and the sentence itself —
 * rendered by `Converter`, *not* as a heading — right below it, where its
 * "Convert from"/"Convert to" labelled comboboxes are exactly as
 * accessible as they are everywhere else the converter appears. Nothing on
 * this page is `aria-hidden`; a screen reader hears the h1 once, then the
 * sentence's own text and controls in visual order, same as a sighted
 * reader sees them.
 */
export default function HomePage() {
  const byCategory = groupToolsByCategory(TOOLS);
  const populatedCategories = CATEGORIES.filter((category) =>
    byCategory.has(category),
  );

  return (
    <PageShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-16 lg:px-12">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
              Convert, compress and edit files without uploading them.
            </h1>
            <p className="max-w-2xl text-ink-muted">
              Everything runs in your browser, even video.
            </p>
          </div>

          <Converter variant="hero" />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
            <Link
              href="/compress"
              className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Make a file smaller
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link
              href="/privacy"
              className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              How we know your files stay put
            </Link>
          </div>
        </section>

        {populatedCategories.map((category) => {
          const tools = byCategory.get(category) ?? [];
          const meta = CATEGORY_META[category];

          return (
            <section key={category} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="flex items-center gap-2 font-display text-2xl font-medium text-ink">
                  <span
                    aria-hidden="true"
                    className={`size-2.5 rounded-full ${CATEGORY_TINT_BG[category]}`}
                  />
                  {meta.label}
                </h2>
                <Link
                  href={`/${category}`}
                  className="shrink-0 rounded-sm text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  All {meta.label.toLowerCase()} tools
                </Link>
              </div>

              <ul className="columns-2 gap-x-8 sm:columns-3 lg:columns-4">
                {tools.map((tool) => (
                  <li key={tool.slug} className="break-inside-avoid py-1">
                    <Link
                      href={`/tools/${tool.slug}`}
                      className="rounded-sm text-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      {shortToolLabel(tool.title)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section
          id="how-we-know"
          className="flex flex-col gap-2 border-t border-border pt-8 text-sm text-ink-muted"
        >
          <h2 className="font-display text-lg font-medium text-ink">
            How we know your files stay put
          </h2>
          <p className="max-w-2xl">
            This page is served with a Content Security Policy that only allows
            it to talk to itself (<code>connect-src 'self'</code>). There's no
            server for it to upload a file to even if it tried. Open your
            browser's network tab, convert something, and you'll see no request
            carrying your file leaves the page. It even keeps working with your
            network turned off, once you've loaded it once.
          </p>
          <Link
            href="/privacy"
            className="w-fit rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Read the full explanation
          </Link>
        </section>
      </div>
    </PageShell>
  );
}

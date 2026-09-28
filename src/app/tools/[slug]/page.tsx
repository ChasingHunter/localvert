import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppTool } from "@/components/app-tool";
import { Breadcrumb } from "@/components/breadcrumb";
import { CATEGORY_TINT_BG } from "@/components/category-tint";
import { PageShell } from "@/components/page-shell";
import { shortToolLabel } from "@/components/tool-groups";
import { ToolHeading } from "@/components/tool-heading";
import { ToolRunner } from "@/components/tool-runner";
import { CATEGORY_META } from "@/lib/registry";
import { TOOLS, TOOLS_BY_SLUG } from "@/tools";

/**
 * A "kind: app" tool renders its own component instead of `ToolRunner`'s
 * job-pipeline dropzone/job-list. `AppTool` (a small client component, same
 * as `ToolRunner` above) is imported directly, not via `next/dynamic` —
 * `next/dynamic`'s `ssr: false` only works from a Client Component, and this
 * page is a Server Component. This page passes `tool.app` (a string id) as a
 * prop; the actual code-split boundary — `next/dynamic(..., {ssr: false})`
 * on the tool's real component — lives in `src/components/app-registry.tsx`,
 * a client-only module `AppTool` reads from, so an app tool's weight (e.g.
 * the PDF editor's `@embedpdf/*` packages) never lands in this page's own
 * first-load JS, nor in any other page's — see ADR-0009 and `app-tool.tsx`.
 */

/** Same category as `tool`, excluding itself, capped for a tidy grid. */
const MAX_RELATED_TOOLS = 6;

/**
 * SERVER COMPONENT. Safe to import `TOOLS`/`TOOLS_BY_SLUG` here — the full
 * registry barrel never reaches the client bundle from a server component.
 * `ToolRunner` (client) loads only its one tool, via `TOOL_LOADERS` — see
 * that file's doc comment and docs/ADDING_A_TOOL.md.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** One static page per registered tool. No other slug resolves — see `dynamicParams`. */
export function generateStaticParams(): { slug: string }[] {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

// A slug outside the registry 404s at build/request time rather than
// falling through to an on-demand render Next has no server to do anyway
// (this is a static export — invariant 4, docs/ARCHITECTURE.md).
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = TOOLS_BY_SLUG.get(slug);
  if (!tool) return {};

  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: `/tools/${tool.slug}` },
  };
}

export default async function ToolPage({ params }: PageProps) {
  const { slug } = await params;
  const tool = TOOLS_BY_SLUG.get(slug);
  if (!tool) notFound();

  const categoryMeta = CATEGORY_META[tool.category];
  const relatedTools = TOOLS.filter(
    (t) => t.category === tool.category && t.slug !== tool.slug,
  ).slice(0, MAX_RELATED_TOOLS);

  return (
    <PageShell>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-16 lg:px-12">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: categoryMeta.label, href: `/${tool.category}` },
            { label: tool.title },
          ]}
        />

        <div className="flex flex-col gap-3">
          <ToolHeading
            slug={tool.slug}
            className="flex items-center gap-3 font-display text-3xl font-medium text-ink sm:text-4xl"
          >
            {/* The one place a tool page carries its category's colour
             * (ADR-0016's design review): a small tint dot beside the
             * title, echoing the same dot the home page's category
             * headings use. */}
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-full ${CATEGORY_TINT_BG[tool.category]}`}
            />
            {tool.title}
          </ToolHeading>
          <p className="max-w-2xl text-ink-muted">{tool.description}</p>
          <Link
            href="/#converter"
            className="self-start rounded-sm text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Convert something else
          </Link>
        </div>

        {tool.kind === "app" && tool.app ? (
          <AppTool appId={tool.app} />
        ) : (
          <ToolRunner slug={tool.slug} />
        )}

        {relatedTools.length > 0 && (
          <section
            aria-labelledby="related-tools-heading"
            className="flex flex-col gap-3"
          >
            <h2
              id="related-tools-heading"
              className="text-sm font-medium text-ink-muted"
            >
              Related tools
            </h2>
            <ul className="columns-2 gap-x-8 sm:columns-3">
              {relatedTools.map((related) => (
                <li key={related.slug} className="break-inside-avoid py-1">
                  <Link
                    href={`/tools/${related.slug}`}
                    className="rounded-sm text-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    {shortToolLabel(related.title)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageShell>
  );
}

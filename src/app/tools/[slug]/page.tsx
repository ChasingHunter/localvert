import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { PageShell } from "@/components/page-shell";
import { ToolCard } from "@/components/tool-card";
import { ToolRunner } from "@/components/tool-runner";
import { CATEGORY_META } from "@/lib/registry";
import { TOOLS, TOOLS_BY_SLUG } from "@/tools";

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
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: categoryMeta.label, href: `/${tool.category}` },
            { label: tool.title },
          ]}
        />

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {tool.title}
          </h1>
          <p className="text-ink-muted">{tool.description}</p>
        </div>

        <ToolRunner slug={tool.slug} />

        <aside
          aria-label="How it works and privacy"
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-ink-muted"
        >
          <p>
            Your file is read in the browser, converted in a Web Worker, and
            handed back as a download — nothing is uploaded.
          </p>
          <p>
            Files stay on your device the whole time. Open your browser's
            network tab during a conversion to verify it yourself.
          </p>
        </aside>

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
            <div className="grid gap-3 sm:grid-cols-2">
              {relatedTools.map((related) => (
                <ToolCard key={related.slug} tool={related} />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}

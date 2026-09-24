import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolRunner } from "@/components/tool-runner";
import { TOOLS, TOOLS_BY_SLUG } from "@/tools";

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{tool.title}</h1>
        <p className="text-ink-muted">{tool.description}</p>
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
          Files stay on your device. This conversion runs entirely in your
          browser — nothing is uploaded.
        </p>
      </div>

      <ToolRunner slug={tool.slug} />
    </main>
  );
}

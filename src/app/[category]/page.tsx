import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ToolCard } from "@/components/tool-card";
import { groupToolsByCategory } from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META, type Category } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * SERVER COMPONENT. One static page per category that has at least one
 * registered tool — see `docs/ADDING_A_TOOL.md`: a new tool file shows up
 * here on its next `pnpm gen`, no page edit required. Route is `/<category>`
 * (e.g. `/image`), never `/category/<slug>` — see the route-collision test
 * below for why that's safe against `/tools` and `/offline`.
 */

const byCategory = groupToolsByCategory(TOOLS);

interface PageProps {
  params: Promise<{ category: string }>;
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** One static page per category that has a tool. No other slug resolves — see `dynamicParams`. */
export function generateStaticParams(): { category: string }[] {
  return CATEGORIES.filter((category) => byCategory.has(category)).map(
    (category) => ({ category }),
  );
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { category } = await params;
  if (!isCategory(category)) return {};
  const meta = CATEGORY_META[category];

  return {
    title: `${meta.label} tools`,
    description: meta.description,
    alternates: { canonical: `/${category}` },
  };
}

export default async function CategoryPage({ params }: PageProps) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  const meta = CATEGORY_META[category];
  const tools = byCategory.get(category);
  if (!tools) notFound();

  return (
    <PageShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {meta.label} tools
          </h1>
          <p className="text-ink-muted">{meta.description}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

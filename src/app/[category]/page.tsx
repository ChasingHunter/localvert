import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_TINT_BG } from "@/components/category-tint";
import { Converter } from "@/components/converter/converter";
import { PageShell } from "@/components/page-shell";
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
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16 lg:px-12">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-3 font-display text-3xl font-medium text-ink sm:text-4xl">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-full ${CATEGORY_TINT_BG[category]}`}
            />
            {meta.label} tools
          </h1>
          <p className="max-w-2xl text-ink-muted">{meta.description}</p>
        </div>

        <Converter category={category} />

        <ul className="flex flex-col divide-y divide-border">
          {tools.map((tool) => (
            <li key={tool.slug} className="flex flex-col gap-0.5 py-3">
              <Link
                href={`/tools/${tool.slug}`}
                className="w-fit rounded-sm font-medium text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {tool.title}
              </Link>
              <p className="max-w-2xl text-sm text-ink-muted">
                {tool.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}

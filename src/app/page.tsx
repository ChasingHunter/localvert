import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { ToolCard } from "@/components/tool-card";
import { groupToolsByCategory } from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import { TOOLS } from "@/tools";

/** Cards shown per category before the section's "All … tools →" link takes over. */
const MAX_HOME_CARDS = 6;

const HOW_IT_WORKS = [
  { step: "1", title: "Pick a tool", body: "Choose the conversion you need." },
  { step: "2", title: "Drop files", body: "Files are read, never uploaded." },
  { step: "3", title: "Download", body: "The result comes straight back." },
] as const;

/**
 * SERVER COMPONENT, no client JS. Hero, then one section per category that
 * has a tool — derived from the registry, so a new tool file shows up here
 * automatically on its next `pnpm gen` (docs/ADDING_A_TOOL.md).
 */
export default function HomePage() {
  const byCategory = groupToolsByCategory(TOOLS);
  const populatedCategories = CATEGORIES.filter((category) =>
    byCategory.has(category),
  );

  return (
    <PageShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
        <section className="flex flex-col gap-6">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
            Convert files without uploading them
          </h1>

          <p className="max-w-2xl text-lg text-ink-muted">
            Images, video, audio, PDFs and documents, converted on your own
            device. Your files never leave this device.
          </p>

          <p className="max-w-2xl text-sm text-ink-muted">
            Nothing is uploaded — not as a policy, but because the page is
            served with a Content Security Policy that makes it impossible. Open
            the network tab and watch.
          </p>

          <ol className="grid gap-3 sm:grid-cols-3">
            {HOW_IT_WORKS.map(({ step, title, body }) => (
              <li
                key={step}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <span className="text-xs font-medium text-accent">
                  Step {step}
                </span>
                <span className="text-sm font-medium text-ink">{title}</span>
                <span className="text-xs text-ink-muted">{body}</span>
              </li>
            ))}
          </ol>
        </section>

        {populatedCategories.map((category) => {
          const tools = byCategory.get(category) ?? [];
          const meta = CATEGORY_META[category];

          return (
            <section key={category} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <h2 className="text-lg font-semibold">{meta.label}</h2>
                  <p className="text-sm text-ink-muted">{meta.description}</p>
                </div>
                <Link
                  href={`/${category}`}
                  className="shrink-0 rounded-sm text-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  All {meta.label.toLowerCase()} tools →
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tools.slice(0, MAX_HOME_CARDS).map((tool) => (
                  <ToolCard key={tool.slug} tool={tool} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}

import Link from "next/link";
import { CATEGORIES, CATEGORY_META, type ToolDefinition } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * SERVER COMPONENT, no client JS. Tools grouped by category, derived from
 * the registry — a new tool file shows up here automatically on its next
 * `pnpm gen`, no page edit required (docs/ADDING_A_TOOL.md).
 */
export default function HomePage() {
  const byCategory = new Map<string, ToolDefinition[]>();
  for (const tool of TOOLS) {
    const list = byCategory.get(tool.category);
    if (list) list.push(tool);
    else byCategory.set(tool.category, [tool]);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-6">
        <h1 className="text-4xl font-semibold tracking-tight">Localvert</h1>

        <p className="text-lg text-ink-muted">
          File conversion that never leaves your browser. Images, video, audio,
          PDFs and documents, converted on your own device.
        </p>

        <p className="text-sm text-ink-muted">
          Nothing is uploaded — not as a policy, but because the page is served
          with a Content Security Policy that makes it impossible. Open the
          network tab and watch.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        {CATEGORIES.filter((category) => byCategory.has(category)).map(
          (category) => (
            <section key={category} className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {CATEGORY_META[category].label}
                </h2>
                <p className="text-sm text-ink-muted">
                  {CATEGORY_META[category].description}
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {byCategory.get(category)?.map((tool) => (
                  <li key={tool.slug}>
                    <Link
                      href={`/tools/${tool.slug}`}
                      className="block rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-canvas"
                    >
                      {tool.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </main>
  );
}

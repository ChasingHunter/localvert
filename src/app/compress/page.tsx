import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_TINT_BG } from "@/components/category-tint";
import { PageShell } from "@/components/page-shell";
import { orderedCompressors } from "@/lib/compress-tools";
import { openGraph } from "@/lib/site";
import { TOOLS } from "@/tools";

/**
 * "Make a file smaller" hub (docs/ROADMAP.md's "Before cutting v0.4.0",
 * positioning research 2026-09-28: people search for compression by
 * format, so each compress tool lives under its own format page — this is
 * the one cross-cutting page that lists all of them together). The slug
 * list, and its order (shared with the header's Compress menu), lives in
 * `@/lib/compress-tools`.
 */

export const metadata: Metadata = {
  title: "Make a file smaller",
  description:
    "Shrink JPG, PNG, WebP, PDF, video and audio files, all in your browser. Pick best quality, a target size, or cut it by a percentage.",
  alternates: { canonical: "/compress" },
  openGraph: openGraph("/compress"),
};

export default function CompressPage() {
  const tools = orderedCompressors(TOOLS);

  return (
    <PageShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-16 lg:px-12">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
            Make a file smaller
          </h1>
          <p className="max-w-2xl text-ink-muted">
            Every compress tool in one place. Each one keeps a best-quality
            default, and lets you aim for a target size or cut the file by a
            percentage instead. None of them ever make the file bigger.
          </p>
        </div>

        <ul className="flex flex-col divide-y divide-border">
          {tools.map((tool) => (
            <li key={tool.slug} className="flex flex-col gap-0.5 py-3">
              <Link
                href={`/tools/${tool.slug}`}
                className="flex w-fit items-center gap-2 rounded-sm font-medium text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span
                  aria-hidden="true"
                  className={`size-2.5 shrink-0 rounded-full ${CATEGORY_TINT_BG[tool.category]}`}
                />
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

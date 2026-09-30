import type { Metadata } from "next";
import Link from "next/link";
import { Converter } from "@/components/converter/converter";
import { PageShell } from "@/components/page-shell";
import {
  groupPdfHubTools,
  PDF_HUB_GROUP_LABELS,
  PDF_HUB_GROUPS,
} from "@/lib/pdf-hub";
import { openGraph } from "@/lib/site";
import { TOOLS } from "@/tools";

/**
 * The PDF hub (docs/ROADMAP.md's "Before cutting v0.4.0", positioning
 * research 2026-09-28): PDF is Localvert's biggest single audience, and
 * that audience wants a PDF suite, not one category among six. This page
 * gets its own hero and a suite-style layout — editor first, then tools
 * grouped the way iLovePDF/Smallpdf group them (Organize, Optimize,
 * Convert, Edit, Security) — instead of the generic `[category]/page.tsx`
 * flat list every other category uses. Group membership comes from
 * `src/lib/pdf-hub.ts`'s hand-written map, unit-tested there.
 *
 * `dynamic = "force-static"` isn't needed here (this route has no dynamic
 * segment), but see `src/app/[category]/page.tsx` for why "pdf" is excluded
 * from that page's `generateStaticParams` — this file replaces it.
 */

const EDITOR_SLUG = "pdf-editor";

export const metadata: Metadata = {
  title: "PDF tools",
  description:
    "Every PDF tool you need: edit, merge, split, compress, convert and secure PDFs, all in your browser. Your file never leaves your device.",
  alternates: { canonical: "/pdf" },
  openGraph: openGraph("/pdf"),
};

export default function PdfHubPage() {
  const pdfTools = TOOLS.filter(
    (tool) => tool.category === "pdf" || tool.slug.endsWith("-to-pdf"),
  );
  const grouped = groupPdfHubTools(pdfTools);
  const editor = pdfTools.find((tool) => tool.slug === EDITOR_SLUG);

  return (
    <PageShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 lg:px-12">
        <section className="flex flex-col gap-4">
          <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
            Every PDF tool you need. Your file never leaves your device.
          </h1>
          <p className="max-w-2xl text-ink-muted">
            Edit, merge, split, compress, convert and secure PDFs, all processed
            on your own machine. Nothing you open here is uploaded.
          </p>

          {editor && (
            <Link
              href={`/tools/${editor.slug}`}
              className="w-fit rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Edit a PDF
            </Link>
          )}
        </section>

        <Converter category="pdf" variant="hero" size="compact" />

        {PDF_HUB_GROUPS.map((group) => {
          const tools = grouped.get(group) ?? [];
          if (tools.length === 0) return null;

          return (
            <section key={group} className="flex flex-col gap-3">
              <h2 className="font-display text-xl font-medium text-ink">
                {PDF_HUB_GROUP_LABELS[group]}
              </h2>
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
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}

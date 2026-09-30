import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { openGraph } from "@/lib/site";

/**
 * Index of the /vs/* comparison pages. One factual line each, lifted from
 * the "core difference" on the page itself, so the index can't promise
 * something the page doesn't say.
 */
const COMPARISONS = [
  {
    href: "/vs/ilovepdf",
    name: "iLovePDF",
    summary:
      "A large PDF toolkit that uploads your file to its server. Localvert does the same jobs in your browser.",
  },
  {
    href: "/vs/smallpdf",
    name: "Smallpdf",
    summary:
      "A polished PDF suite with a free tier and paid plans, processed on its servers. Localvert never uploads.",
  },
  {
    href: "/vs/vert",
    name: "VERT",
    summary:
      "An open-source converter with a very wide format list. It converts most files locally but sends video to a server.",
  },
] as const;

export const metadata: Metadata = {
  title: "Compare Localvert",
  description:
    "How Localvert compares to iLovePDF, Smallpdf and VERT: what each does well, and where your files go.",
  alternates: { canonical: "/vs" },
  openGraph: openGraph("/vs"),
};

export default function VsIndexPage() {
  return (
    <PageShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-16 lg:px-12">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
            Compare Localvert
          </h1>
          <p className="text-ink-muted">
            Other tools do this job well too. Here is how each one differs from
            Localvert, and when you might pick it instead.
          </p>
        </div>

        <ul className="flex max-w-2xl flex-col divide-y divide-border">
          {COMPARISONS.map((item) => (
            <li key={item.href} className="flex flex-col gap-0.5 py-3">
              <Link
                href={item.href}
                className="w-fit rounded-sm font-medium text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Localvert vs {item.name}
              </Link>
              <p className="text-sm text-ink-muted">{item.summary}</p>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}

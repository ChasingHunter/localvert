import type { ReactNode } from "react";
import { PageShell } from "@/components/page-shell";

interface Source {
  label: string;
  href: string;
}

interface VsPageProps {
  name: string;
  lastChecked: string;
  intro: ReactNode;
  doesWell: ReactNode[];
  coreDifference: ReactNode;
  whenToPreferThem: ReactNode[];
  sources: Source[];
}

/**
 * Shared layout for the /vs/* comparison pages (docs/ROADMAP.md's "Before
 * cutting v0.4.0"; content sourced from
 * .claude/plans/2026-09-28-positioning-research.md). Every claim on these
 * pages traces to that research file's sources, which is why each page
 * lists them and stamps a "last checked" date rather than presenting the
 * numbers as current fact. Trademarks appear as plain names only, no logos.
 */
export function VsPage({
  name,
  lastChecked,
  intro,
  doesWell,
  coreDifference,
  whenToPreferThem,
  sources,
}: VsPageProps) {
  return (
    <PageShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 lg:px-12">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
            Localvert vs {name}
          </h1>
          <p className="text-ink-muted">{intro}</p>
          <p className="text-sm text-ink-muted">Last checked {lastChecked}.</p>
        </div>

        <section className="flex max-w-2xl flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            What {name} does well
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-muted">
            {doesWell.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable content
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="flex max-w-2xl flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            The core difference
          </h2>
          <p className="text-ink-muted">{coreDifference}</p>
        </section>

        <section className="flex max-w-2xl flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            When you might still prefer {name}
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-muted">
            {whenToPreferThem.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable content
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="flex max-w-2xl flex-col gap-2 border-t border-border pt-6 text-sm text-ink-muted">
          <h2 className="font-display text-base font-medium text-ink">
            Sources
          </h2>
          <ul className="flex flex-col gap-1">
            {sources.map((source) => (
              <li key={source.href}>
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}

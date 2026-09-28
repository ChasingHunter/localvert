import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Next's reserved file: renders for any unmatched route, and — in a static
 * export (invariant 4) — is also what `next build` turns into `out/404.html`
 * for Cloudflare to serve on a real 404 (see `infra/`). Plain copy per
 * ADR-0016's voice: say what happened, give one way back.
 */
export default function NotFound() {
  return (
    <PageShell>
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <h1 className="font-display text-4xl font-medium text-ink">
          That page doesn't exist.
        </h1>

        <p className="text-lg text-ink-muted">
          The link might be old, or the address might be off. Nothing was
          converted or lost — there's no server keeping track either way.
        </p>

        <Link
          href="/"
          className="inline-flex w-fit min-h-11 items-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Go home
        </Link>
      </div>
    </PageShell>
  );
}

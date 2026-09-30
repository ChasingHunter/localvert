import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Offline",
  // Offline fallback page, not real content — keep it out of search results.
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <PageShell>
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <h1 className="font-display text-4xl font-medium text-ink">
          You're offline
        </h1>

        <p className="text-lg text-ink-muted">
          This page needs a connection you don't have right now. Any tool you've
          already opened keeps converting. Everything runs on your own device,
          so it never needed the network in the first place.
        </p>

        <a
          href="/"
          className="inline-flex w-fit min-h-11 items-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Try again
        </a>
      </div>
    </PageShell>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">You're offline</h1>

      <p className="text-lg text-ink-muted">
        This page needs a connection you don't have right now. Any tool you've
        already opened keeps converting — everything runs on your own device, so
        it never needed the network in the first place.
      </p>

      <a
        href="/"
        className="rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm"
      >
        Try again
      </a>
    </main>
  );
}

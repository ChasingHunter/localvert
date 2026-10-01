import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { openGraph } from "@/lib/site";
import { StoragePanel } from "./storage-panel";

export const metadata: Metadata = {
  title: "Storage",
  description:
    "See which converters Localvert has downloaded to this device, how much space they use, and remove them.",
  alternates: { canonical: "/storage" },
  openGraph: openGraph("/storage"),
  // A utility page about this browser's own state, not search content.
  robots: { index: false },
};

export default function StoragePage() {
  return (
    <PageShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16 lg:px-12">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
            Storage
          </h1>
          <p className="text-ink-muted">
            Localvert keeps the converters it downloads so they work offline
            next time. Your files are never stored here.
          </p>
        </div>
        <StoragePanel />
      </div>
    </PageShell>
  );
}

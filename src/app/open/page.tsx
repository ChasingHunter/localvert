import type { Metadata } from "next";
import { OpenFiles } from "@/components/open-files";
import { PageShell } from "@/components/page-shell";

/**
 * ADR-0018: where the installed app lands when the OS opens a file with it
 * (and, once the service worker stashes them, files from the share sheet).
 * Not content, so it is noindex and left out of the sitemap.
 */
export const metadata: Metadata = {
  title: "Opening files",
  robots: { index: false },
};

export default function OpenPage() {
  return (
    <PageShell>
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <OpenFiles />
      </div>
    </PageShell>
  );
}

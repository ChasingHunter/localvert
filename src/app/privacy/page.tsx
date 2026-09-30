import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { openGraph } from "@/lib/site";

/**
 * The trust page (docs/ROADMAP.md's "Before cutting v0.4.0"): how to check
 * for yourself that nothing uploads, not just a claim to take on faith.
 * Every factual claim here (the CSP directive, what's stored locally, that
 * there's no analytics) was checked against the actual source before
 * writing it down — see `public/_headers` for the CSP and the grep the
 * planner ran over `src/**` for tracking code, cookies and accounts, which
 * came back empty.
 */

export const metadata: Metadata = {
  title: "How we know your files stay put",
  description:
    "How to check for yourself that Localvert never uploads your files: the CSP header, the network tab, working offline, and the source code.",
  alternates: { canonical: "/privacy" },
  openGraph: openGraph("/privacy"),
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 lg:px-12">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-medium text-ink sm:text-4xl">
            How we know your files stay put
          </h1>
          <p className="max-w-2xl text-ink-muted">
            This isn't a promise to take on faith. Everything below, you can
            check yourself in a minute or two.
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            The page can't upload your file even if it tried
          </h2>
          <p className="max-w-2xl text-ink-muted">
            Every page on this site is served with a Content Security Policy
            that only allows it to talk to itself:
          </p>
          <pre className="max-w-2xl overflow-x-auto rounded-lg border border-border bg-surface p-3 text-sm text-ink">
            <code>connect-src 'self' blob:</code>
          </pre>
          <p className="max-w-2xl text-ink-muted">
            Open your browser's developer tools, go to the Network tab, and look
            at the response headers for this page. You'll see that line in the{" "}
            <code>Content-Security-Policy</code> header. It's a browser-enforced
            rule, not application code: even a bug in Localvert couldn't send
            your file anywhere else, because the browser itself refuses the
            request.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            Watch the network tab while you convert something
          </h2>
          <p className="max-w-2xl text-ink-muted">
            With that same Network tab open, convert a file. You'll see the page
            load its own code and, the first time you use a format, fetch the
            engine that handles it (details below). You won't see any request
            carrying your file's contents leave the page, because there isn't
            one.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            It keeps working with your network off
          </h2>
          <p className="max-w-2xl text-ink-muted">
            Load the site once, then turn off your network connection (or use
            your browser's offline mode) and convert a file you've already used
            a tool for. It still works, because the conversion runs entirely on
            your own machine. There's no server in the loop to lose.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            The source is open
          </h2>
          <p className="max-w-2xl text-ink-muted">
            Read the code that runs on this page, or check it against what your
            browser actually loaded.
          </p>
          <a
            href="https://github.com/ChasingHunter/localvert"
            target="_blank"
            rel="noreferrer"
            className="w-fit rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Source on GitHub
          </a>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            What is downloaded, and when
          </h2>
          <p className="max-w-2xl text-ink-muted">
            Some formats need a real codec or library to convert, not just
            browser APIs, so the first time you use one of those tools, this
            site downloads that engine (for example FFmpeg or LibreOffice) to
            your browser. Large engines ask first and only download after you
            agree. Once downloaded, an engine is cached in your browser and
            reused, without another download, until it's updated. That download
            is the engine's own code, never your file, and it's covered by the
            same CSP above: it can only come from this site's own origin.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium text-ink">
            No accounts, no cookies, no analytics
          </h2>
          <p className="max-w-2xl text-ink-muted">
            There's no sign-up, no cookie banner (because there are no cookies
            to consent to), and no analytics or tracking script anywhere on this
            site. The only things this site stores are in your own browser,
            never sent anywhere: your light or dark theme choice, whether you've
            already agreed to download a given engine, and, only if you turn
            them on, an editor draft or a saved signature for the PDF editor.
            Each of those is a plain local setting you can clear from your
            browser at any time.
          </p>
        </section>

        <p className="max-w-2xl border-t border-border pt-6 text-sm text-ink-muted">
          See how Localvert compares to a few well-known converters:{" "}
          <Link
            href="/vs/ilovepdf"
            className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            iLovePDF
          </Link>
          ,{" "}
          <Link
            href="/vs/smallpdf"
            className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Smallpdf
          </Link>
          , and{" "}
          <Link
            href="/vs/vert"
            className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            VERT
          </Link>
          .
        </p>
      </div>
    </PageShell>
  );
}

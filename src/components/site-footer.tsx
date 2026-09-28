/**
 * SERVER COMPONENT, no client JS. Deliberately small and plain: the privacy
 * fact restated once more, a link to the source (so "verify it yourself"
 * has somewhere to go) and the two font licences (ADR-0016 self-hosts
 * Fraunces and Figtree, both OFL-1.1 — attribution belongs on every page
 * that uses them, not just docs/THIRD_PARTY_LICENSES.md).
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-ink-muted lg:px-12">
        <p>
          Nothing you convert here is ever uploaded. Open your browser's network
          tab while you use it and see for yourself.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href="https://github.com/ChasingHunter/localvert"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm font-medium text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Source on GitHub
          </a>
          <span>
            Set in Fraunces and Figtree, both licensed under the{" "}
            <a
              href="https://openfontlicense.org/"
              target="_blank"
              rel="noreferrer"
              className="rounded-sm font-medium text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              SIL Open Font License
            </a>
            .
          </span>
        </div>
      </div>
    </footer>
  );
}

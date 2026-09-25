/**
 * SERVER COMPONENT, no client JS. Deliberately small: a link to the repo (so
 * "verify it yourself" has somewhere to go) and one line restating the
 * privacy promise. No licenses/legal page exists yet, so nothing links there.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-8 text-sm text-ink-muted">
        <p>No uploads. Verify in devtools.</p>
        <a
          href="https://github.com/ChasingHunter/localvert"
          target="_blank"
          rel="noreferrer"
          className="rounded-sm font-medium text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}

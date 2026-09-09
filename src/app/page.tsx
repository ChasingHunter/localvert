export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Localvert</h1>

      <p className="text-lg text-ink-muted">
        File conversion that never leaves your browser. Images, video, audio,
        PDFs and documents, converted on your own device.
      </p>

      <p className="text-sm text-ink-muted">
        Nothing is uploaded — not as a policy, but because the page is served
        with a Content Security Policy that makes it impossible. Open the
        network tab and watch.
      </p>

      <p className="rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm">
        Scaffold. The first converter arrives in Phase 0.5.
      </p>
    </main>
  );
}

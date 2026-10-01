"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { engineDisplayName } from "@/lib/engines/display-names";

/** GitHub's rendering of the license/attribution table for every third-party
 * engine — see ADR-0002 rule 5's "full attribution and source offer". No
 * in-app licenses page exists yet (src/components/site-footer.tsx says so
 * directly), so this links straight at the doc on GitHub. */
const LICENSES_URL =
  "https://github.com/ChasingHunter/localvert/blob/main/docs/THIRD_PARTY_LICENSES.md";

interface EngineConsentDialogProps {
  open: boolean;
  /** e.g. "ffmpeg" — mapped to a proper display name via `engineDisplayName` below. */
  engineId: string;
  /** e.g. "GPL-2.0-or-later". */
  license: string;
  /** Total download size, in bytes — see `downloadBytes` in `consent.ts`. */
  bytes: number;
  /** Upstream source repository, for the GPL source-offer link. */
  sourceUrl: string;
  onDownload: () => void;
  onCancel: () => void;
}

/** Rounds to whole megabytes for the prompt text — "31 MB", not a
 * false-precision byte count nobody can act on. */
function toMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * ADR-0002 rule 4: the explicit, size-gated prompt in front of a
 * consent-gated engine's first download (currently only `ffmpeg`). A native
 * `<dialog>` rather than a hand-rolled overlay — `showModal`/`close` give
 * focus trapping, `Esc`-to-cancel and top-layer stacking for free.
 * `tool-runner.tsx`'s `ensureConsent` owns when this opens and what happens
 * on each button; this component only renders the prompt and reports the
 * choice.
 */
export function EngineConsentDialog({
  open,
  engineId,
  license,
  bytes,
  sourceUrl,
  onDownload,
  onCancel,
}: EngineConsentDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // `showModal()` alone focuses the dialog's first focusable element —
      // here, the "Upstream source" link — not the primary action. A person
      // who just hits Enter (the natural first move on a dialog that just
      // grabbed focus) would follow an external link instead of proceeding,
      // so the primary button gets focus explicitly once the dialog is open.
      downloadRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const displayName = engineDisplayName(engineId);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="fixed inset-0 m-auto max-w-md rounded-2xl border border-border bg-surface p-6 text-ink shadow-lg backdrop:bg-ink/40"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <h2 id={titleId} className="text-base font-semibold">
        Download {displayName} to convert this file?
      </h2>
      <p className="mt-3 text-sm text-ink-muted">
        It's a one-time {toMb(bytes)} MB download. After that it works offline,
        and your files still never leave this device.
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        Licensed under {license}.{" "}
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-accent underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Upstream source
        </a>
        {" · "}
        <a
          href={LICENSES_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-accent underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          License details
        </a>
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          className="rounded-full"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          ref={downloadRef}
          type="button"
          className="rounded-full"
          onClick={onDownload}
        >
          Download and convert
        </Button>
      </div>
    </dialog>
  );
}

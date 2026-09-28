import Link from "next/link";

interface PrivacyNoteProps {
  /** Smaller text for a page that already has other copy nearby (tool and
   * category pages) — the home hero keeps the default, larger size. */
  size?: "base" | "sm";
}

/**
 * The one privacy line a page gets near its drop area (ADR-0016's design
 * review: the same fact was showing up three or four times on a single tool
 * page). Used by the home hero's `Converter` and by `ToolRunner`'s own drop
 * area — every other privacy mention (the site footer, the home page's "How
 * we know" section) says something different and stays as is.
 *
 * Deliberately not `cn()` (clsx + tailwind-merge) — this renders on the home
 * page's first load, which `combobox.tsx` already documents as too tight a
 * budget for that helper (see its own `classes()` above).
 */
export function PrivacyNote({ size = "base" }: PrivacyNoteProps) {
  return (
    <p
      className={`max-w-2xl text-ink-muted ${size === "sm" ? "text-sm" : "text-base"}`}
    >
      Your files stay on this device. Nothing is uploaded.{" "}
      <Link
        href="/#how-we-know"
        className="rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        How we know
      </Link>
    </p>
  );
}

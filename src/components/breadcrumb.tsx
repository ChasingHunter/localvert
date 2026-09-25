import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  /** Omitted (or on the last item, ignored) for the current page — text, not a link. */
  href?: string;
}

interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
}

/**
 * SERVER COMPONENT, no client JS. "Home › Images › JPG to PNG" — every item
 * but the last links out; the last is the current page (`aria-current`),
 * rendered as plain text even if it carries an `href`.
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">›</span>}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="rounded-sm outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="text-ink"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

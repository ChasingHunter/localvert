import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

interface PageShellProps {
  children: ReactNode;
}

/**
 * Shared chrome (header + footer) for every page except the root layout,
 * which only owns the service worker registration (`src/app/layout.tsx`) —
 * that stays a plain `<body>{children}</body>` so it keeps working
 * regardless of what any page renders. Each page calls `PageShell` itself
 * instead, wrapping its own content as `children`.
 *
 * SERVER COMPONENT, no client JS: `SiteHeader`/`SiteFooter` are server
 * components too, so using this adds nothing to a page's bundle.
 *
 * Landmarks: `SiteHeader` renders `<header>`/`<nav>`, this renders `<main>`,
 * `SiteFooter` renders `<footer>` — one of each per page.
 */
export function PageShell({ children }: PageShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

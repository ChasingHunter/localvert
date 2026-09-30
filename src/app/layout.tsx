import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { openGraph, SITE_URL } from "@/lib/site";
import { THEME_STORAGE_KEY } from "@/lib/theme-storage";
import { ServiceWorker } from "./service-worker";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Localvert · file conversion that never leaves your browser",
    template: "%s · Localvert",
  },
  description:
    "Convert images, video, audio, PDFs and documents entirely on your own device. No upload, no account, no server. Your files never leave your browser.",
  applicationName: "Localvert",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: openGraph("/"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1a18" },
  ],
};

/**
 * No-flash theme script (ADR-0016): applies the persisted choice to
 * `<html data-theme>` before first paint, so a returning visitor who chose
 * "light" or "dark" never sees a flash of the system-default theme. Reads
 * the exact key `ThemeToggle` writes (`THEME_STORAGE_KEY`, from the plain
 * `src/lib/theme-storage.ts` module — see its doc comment for why that
 * constant isn't just exported from `theme-toggle.tsx` itself), built into
 * the inlined script text at build time rather than hand-duplicated.
 *
 * This is a plain `<script>` tag, deliberately not `next/script`: with
 * `strategy="beforeInteractive"`, Next doesn't render the script as literal
 * HTML in a static export — it ships the body through the RSC payload and
 * inserts the element at runtime via `document.createElement`/`appendChild`
 * instead. `scripts/csp-inline-hashes.ts` only ever sees the built HTML
 * files, so a runtime-inserted script's hash is never in the allowlist and
 * the browser blocks it (caught by e2e/converter.spec.ts's CSP-violation
 * guard). A plain `<script>` in a server component's JSX renders as literal
 * HTML like any other host element, so it's both hashable at build time and
 * — being the first thing in `<body>`, before any themed content — runs
 * synchronously ahead of paint, which is the actual no-flash requirement.
 */
const noFlashThemeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed, build-time-generated script content, not user data.
          dangerouslySetInnerHTML={{ __html: noFlashThemeScript }}
        />
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}

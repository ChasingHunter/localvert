import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { THEME_STORAGE_KEY } from "@/lib/theme-storage";
import { ServiceWorker } from "./service-worker";

export const metadata: Metadata = {
  title: {
    default: "Localvert — file conversion that never leaves your browser",
    template: "%s — Localvert",
  },
  description:
    "Convert images, video, audio, PDFs and documents entirely on your own device. No upload, no account, no server. Your files never leave your browser.",
  applicationName: "Localvert",
  robots: { index: true, follow: true },
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
 * `next/script` with `beforeInteractive` is the one supported way to inject
 * a script that runs ahead of hydration in a static export; it renders
 * straight into `<head>`. The exact inlined bytes get hash-allowlisted into
 * each page's script-src by `scripts/csp-inline-hashes.ts` as part of
 * `pnpm build` — this script is never given an `'unsafe-inline'` pass.
 */
const noFlashThemeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <Script
          id="no-flash-theme"
          strategy="beforeInteractive"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed, build-time-generated script content, not user data — next/script requires this prop to inline a script body.
          dangerouslySetInnerHTML={{ __html: noFlashThemeScript }}
        />
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}

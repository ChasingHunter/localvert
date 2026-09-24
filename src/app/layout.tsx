import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
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
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1c20" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}

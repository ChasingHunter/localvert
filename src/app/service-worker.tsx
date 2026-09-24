"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (src/sw.ts, built to /sw.js — see
 * scripts/build-sw.ts) in production only. A component, not an inline
 * `<script>`: an inline script needs its own hash in the per-page meta CSP
 * (docs/adr/0006) — every page would need one for this exact same call — a
 * regular chunk is simpler and is already covered by the header CSP's
 * `script-src 'self'`.
 *
 * Renders nothing; only the effect matters.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      type: "module",
    });
  }, []);

  return null;
}

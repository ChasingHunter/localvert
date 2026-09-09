import type { NextConfig } from "next";

/**
 * Cross-origin isolation headers.
 *
 * These are what make `SharedArrayBuffer` available, which multithreaded wasm
 * engines need. In production they are served by Cloudflare from
 * `public/_headers` — `output: "export"` produces static files, so Next has no
 * server left to apply headers with, and it warns if you configure them.
 *
 * The dev server does have a server, so we apply them here for `next dev`
 * only. Without this, `crossOriginIsolated` is false in development and every
 * multithreaded engine silently falls back to its single-threaded path, so a
 * threading bug would not show up until production.
 *
 * Keep this in sync with `public/_headers`.
 */
const crossOriginIsolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Static export. No server, no API routes, no runtime data in components.
  // This is invariant 4 in docs/ARCHITECTURE.md.
  output: "export",

  reactStrictMode: true,

  // No image optimizer exists in a static export; there is no server to run it.
  images: { unoptimized: true },

  // Typechecking is a separate gate (`pnpm typecheck`, run by `pnpm verify`
  // and by CI before the build). Running it again inside `next build` doubles
  // the slowest part of the build for no extra signal.
  typescript: { ignoreBuildErrors: true },

  // Note: Next 16 removed the `eslint` config key along with its built-in
  // ESLint integration. Linting is Biome's job here (`pnpm lint`).

  ...(isDev
    ? {
        headers: async () => [
          { source: "/:path*", headers: crossOriginIsolationHeaders },
        ],
      }
    : {}),
};

export default nextConfig;

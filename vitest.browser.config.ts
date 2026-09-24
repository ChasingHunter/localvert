import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Integration tests in a real browser: workers, wasm, canvas, OPFS.
 *
 * Run with `pnpm test:browser`. Kept separate from the unit run because it
 * needs a browser binary, so it is slower and has a heavier CI setup — but it
 * is the only place an engine is actually exercised.
 *
 * The COOP/COEP headers mirror production (`public/_headers`) and the dev
 * server (`next.config.ts`). Without them `crossOriginIsolated` is false,
 * `SharedArrayBuffer` is undefined, and every multithreaded engine quietly
 * takes its single-threaded path — so the threaded code would go untested
 * while the suite stayed green.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});

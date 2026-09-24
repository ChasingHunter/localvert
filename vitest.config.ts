import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests: pure logic that needs no browser. The registry, the format
 * table, the router's decision function, naming, option coercion.
 *
 * Anything that touches a real worker, a real canvas, or real wasm belongs in
 * `vitest.browser.config.ts` instead — a jsdom shim of those APIs tests the
 * shim, not the engine.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // infra/**: the Cloudflare Worker — plain-fake unit tests, same node
    // environment as everything else here.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "infra/**/*.test.ts"],
    exclude: ["src/**/*.browser.test.ts"],
    restoreMocks: true,
  },
});

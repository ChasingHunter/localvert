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
    // wasm engines (libraw, jsquash-avif/jxl/webp/..., golden's 8 encoders,
    // the real worker pool in pipeline.browser.test.ts) never actually free
    // their heap on `dispose()` — every adapter's own dispose comment says
    // so; Emscripten only releases it when the worker/page hosting the
    // module is torn down. `fileParallelism: false` pins `maxWorkers` to 1,
    // which (combined with `isolate`'s default of `true`) makes Vitest run
    // browser files one at a time on a fresh, disposable page instead of
    // several heavy files loading their wasm modules into the same page at
    // once. Without this, ~14 files' engines piled up in one page/process
    // budget and Chromium's WebAssembly.Memory allocator gave up partway
    // through the run ("could not allocate memory"), which then cascaded
    // into "Browser connection was closed" for whatever ran after.
    isolate: true,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});

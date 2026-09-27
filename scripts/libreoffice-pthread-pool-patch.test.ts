import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBREOFFICE_PTHREAD_POOL_SIZE,
  patchLibreOfficeGlue,
  patchLibreOfficePthreadPool,
} from "./sync-engines";

/**
 * `patchLibreOfficePthreadPool` (ADR-0012, doc comment in `sync-engines.ts`)
 * raises soffice.js's prespawned pthread pool so Calc's xlsx import never
 * waits on a Worker that can't start. Run against the real installed
 * package, so an upgrade that reshapes the pool fails here, not as a silent
 * hang in the browser.
 */

function readRealSoffice(): string {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(
    require.resolve("@bentopdf/libreoffice-wasm/package.json"),
  );
  return readFileSync(join(pkgDir, "assets", "soffice.js"), "utf8");
}

describe("patchLibreOfficePthreadPool", () => {
  it("raises the real package's pool from 4 to the patched size", () => {
    const patched = patchLibreOfficePthreadPool(readRealSoffice());

    expect(patched).not.toContain("var pthreadPoolSize=4;");
    expect(patched).toContain(
      `var pthreadPoolSize=${LIBREOFFICE_PTHREAD_POOL_SIZE};`,
    );
    expect(LIBREOFFICE_PTHREAD_POOL_SIZE).toBeGreaterThanOrEqual(5);
  });

  it("throws if the pool literal is missing (fails the build loudly)", () => {
    const reshaped = readRealSoffice().replace(
      "var pthreadPoolSize=4;",
      "var pthreadPoolSize=navigator.hardwareConcurrency;",
    );
    expect(() => patchLibreOfficePthreadPool(reshaped)).toThrow(
      /expected exactly one "var pthreadPoolSize=4;", found 0/,
    );
  });

  it("throws if the pool literal appears twice", () => {
    expect(() =>
      patchLibreOfficePthreadPool(
        "var pthreadPoolSize=4;var pthreadPoolSize=4;",
      ),
    ).toThrow(/found 2/);
  });
});

describe("patchLibreOfficeGlue", () => {
  it("applies both the embind and the pthread pool patch", () => {
    const patched = patchLibreOfficeGlue(readRealSoffice());

    expect(patched).not.toContain("newFunc(Function");
    expect(patched).toContain(
      `var pthreadPoolSize=${LIBREOFFICE_PTHREAD_POOL_SIZE};`,
    );
  });
});

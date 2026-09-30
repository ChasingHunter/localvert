import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";

/**
 * Live end-to-end run of the typst engine (ADR-0011): `location: "static"`,
 * served straight from this origin's `public/engines/typst--<version>/` —
 * no `wrangler dev` R2 simulation, no download-consent gate, unlike
 * `e2e/legacy-video.spec.ts`'s ffmpeg. The compiler wasm ships gzipped
 * (`typst_ts_web_compiler_bg.wasm.gz`, ~10 MB vs. ~28 MB raw — comfortably
 * under the "static" asset tier without a consent prompt); the adapter
 * decompresses it itself (`DecompressionStream`), since nothing in
 * `public/_headers`/infra declares `Content-Encoding` for `/engines/*`. The
 * wasm-bindgen glue is patched at sync time (`scripts/sync-engines.ts`'s
 * `patchTypstGlue`) to replace two `new Function(string)` stubs with a
 * closed lookup table, so the compiler runs under this app's real CSP (no
 * `unsafe-eval`) — this test's `cspGuard` fixture below is what actually
 * proves that.
 */
function fixturePath(name: string): string {
  return `e2e/fixtures/${name}`;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).subarray(0, 5).toString("latin1") === "%PDF-";
}

interface Fixtures {
  /** Autouse: fails the test if any request left the page's own origin. */
  privacyGuard: undefined;
  /** Autouse: fails the test if the browser ever reported a CSP violation. */
  cspGuard: undefined;
}

const test = base.extend<Fixtures>({
  privacyGuard: [
    async ({ page, baseURL }, use) => {
      const ownOrigin = new URL(baseURL ?? "http://localhost:8788").origin;
      const foreign: string[] = [];
      page.on("request", (request) => {
        const origin = new URL(request.url()).origin;
        if (origin !== ownOrigin) foreign.push(request.url());
      });

      await use(undefined);

      expect(
        foreign,
        "no request should ever leave the page's own origin — files never leave the browser",
      ).toEqual([]);

      const isolated = await page.evaluate(() => self.crossOriginIsolated);
      expect(
        isolated,
        "page must be cross-origin isolated (COOP/COEP from public/_headers)",
      ).toBe(true);
    },
    { auto: true },
  ],

  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.exposeFunction("__onCspViolation", (detail: string) => {
        violations.push(detail);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          // @ts-expect-error — bridged in by exposeFunction above.
          window.__onCspViolation(`${e.violatedDirective}: ${e.blockedURI}`);
        });
      });

      await use(undefined);

      expect(violations, "no CSP violation should occur").toEqual([]);
    },
    { auto: true },
  ],
});

test.describe("markdown to pdf (typst engine, ADR-0011)", () => {
  test("converts a real markdown file to pdf with no consent prompt", async ({
    page,
  }) => {
    // Real ~10 MB gzipped wasm fetch + decompress + a real typst compile.
    test.setTimeout(120_000);
    const engineRequests: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/engines/typst--")) {
        engineRequests.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto("/tools/markdown-to-pdf");

    await page
      .locator('input[type="file"]')
      .setInputFiles(fixturePath("sample.md"));

    // No download-consent dialog for a "static" engine — see this file's
    // top doc comment. The download link appearing at all is proof the
    // conversion ran straight through, unprompted.
    await expect(page.getByRole("dialog", { name: /download/i })).toHaveCount(
      0,
    );

    // Scoped to the job list (`<ul>`, role "list") rather than the whole
    // page: this tool's "Related tools" section includes the libreoffice
    // document tools, whose own descriptions mention "download" (the ~74 MB
    // one-time engine download) — a page-wide `getByRole("link", { name:
    // "Download" })` (substring match) also matches those cards. Same fix
    // as `e2e/office.spec.ts`.
    const downloadLink = page
      .getByRole("list")
      .getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 60_000 });

    expect(
      engineRequests.length,
      "the typst engine must be fetched from this origin's /engines/ prefix",
    ).toBeGreaterThan(0);
    for (const req of engineRequests) {
      // 307 shows up as its own `response` event for a same-origin redirect
      // hop (e.g. Cloudflare Workers static-asset serving normalizing a
      // path) — the browser follows it automatically to a 200/206, so it's
      // not itself a failure.
      expect([200, 206, 307], `${req.url} should succeed`).toContain(
        req.status,
      );
    }

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    expect(hasPdfMagic(readFileSync(path))).toBe(true);
  });
});

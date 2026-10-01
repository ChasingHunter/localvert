import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * End to end against a real built `out/` — see jpg-to-png.spec.ts's doc
 * comment for why. Covers ADR-0018: the web manifest (file handlers, share
 * target), the `/open` page's three entry paths, and the service worker's
 * share-target stash.
 *
 * Neither the OS file-handler launch nor the Android share sheet can be
 * driven from Playwright, so each is simulated at the seam the page sees:
 * a fake `window.launchQueue`, and a POST to `/share-target` that the
 * service worker answers exactly as it would for a real share.
 */

const AAC = "e2e/fixtures/sample.aac";
const PNG = "e2e/fixtures/not-a-jpg.png";

test("the web manifest declares file handlers and a share target", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();

  expect(manifest.name).toBe("Localvert");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain(
    "512x512",
  );

  const [handler] = manifest.file_handlers;
  expect(handler.action).toBe("/open");
  expect(handler.accept["application/pdf"]).toContain(".pdf");
  expect(handler.accept["image/jpeg"]).toContain(".jpg");

  expect(manifest.share_target.action).toBe("/share-target");
  expect(manifest.share_target.method).toBe("POST");
  expect(manifest.share_target.enctype).toBe("multipart/form-data");
  expect(manifest.share_target.params.files[0].name).toBe("files");
  expect(manifest.share_target.params.files[0].accept).toContain(".pdf");
});

test("the app icons are served", async ({ request }) => {
  for (const path of [
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
  ]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
});

test("/open with nothing to open says so and links home", async ({ page }) => {
  await page.goto("/open");
  await expect(
    page.getByText(
      "Open a file with Localvert from your files app, or drop one on the home page.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to the home page" }),
  ).toBeVisible();
});

/** Fakes the File Handling API's launch queue with one file per path. */
async function fakeLaunch(
  page: import("@playwright/test").Page,
  files: { name: string; type: string; path: string }[],
) {
  const payload = files.map((f) => ({
    name: f.name,
    type: f.type,
    base64: readFileSync(f.path).toString("base64"),
  }));
  await page.addInitScript((items) => {
    const handles = items.map((item) => ({
      getFile: async () => {
        const bytes = Uint8Array.from(atob(item.base64), (c) =>
          c.charCodeAt(0),
        );
        return new File([bytes], item.name, { type: item.type });
      },
    }));
    // The File Handling API isn't in lib.dom; open-files.tsx declares it.
    // Chromium already defines launchQueue as an accessor on window, so a
    // plain assignment is silently ignored; redefine it instead.
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(consumer: (p: { files: unknown[] }) => void) {
          queueMicrotask(() => consumer({ files: handles }));
        },
      },
    });
  }, payload);
}

test("a file opened by the OS lands on the one tool that takes it", async ({
  page,
}) => {
  await fakeLaunch(page, [{ name: "voice.aac", type: "audio/aac", path: AAC }]);
  await page.goto("/open");
  await page.waitForURL("**/tools/aac-to-mp3");
  await expect(page.getByText("voice.aac").first()).toBeVisible();
});

test("a file opened by the OS that many tools take lands on the home converter", async ({
  page,
}) => {
  await fakeLaunch(page, [{ name: "shot.png", type: "image/png", path: PNG }]);
  await page.goto("/open");
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByText(/Detected shot\.png/).first()).toBeAttached();
});

test("a file shared to the app is stashed by the service worker and handed on", async ({
  page,
}) => {
  await page.goto("/");
  // The worker registers in production builds only and claims the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const bytes = readFileSync(AAC).toString("base64");
  const type = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("files", new File([data], "shared.aac", { type: "audio/aac" }));
    // A page can't submit a form to /share-target (CSP form-action 'none');
    // the OS share sheet isn't a page, so a fetch stands in for it. The
    // worker answers with a 303 to /open?share=1, which a manual redirect
    // surfaces as an opaque redirect instead of following.
    const res = await fetch("/share-target", {
      method: "POST",
      body: form,
      redirect: "manual",
    });
    return res.type;
  }, bytes);
  expect(type).toBe("opaqueredirect");

  await page.goto("/open?share=1");
  await page.waitForURL("**/tools/aac-to-mp3");
  await expect(page.getByText("shared.aac").first()).toBeVisible();

  // Handed off, so the stash is empty again.
  const left = await page.evaluate(async () => {
    const cache = await caches.open("localvert-share-v1");
    return (await cache.keys()).length;
  });
  expect(left).toBe(0);
});

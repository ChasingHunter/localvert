import { test as base, expect } from "@playwright/test";

/**
 * End to end against a real built `out/` — see jpg-to-png.spec.ts's doc
 * comment for why (`_headers`, COOP/COEP, the real CSP). Unlike that spec,
 * this one builds its JPEG fixture in-memory rather than reading one from
 * `e2e/fixtures/`: `strip-exif` never decodes pixels (it's a byte-to-byte
 * `strip` op, not `imagePipeline`), so the fixture only needs to be a
 * structurally valid JPEG with real EXIF/GPS bytes to strip — it doesn't
 * need to actually render as an image, and building it inline keeps the
 * GPS bytes this test asserts are gone right next to the assertion.
 */

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}
function asciiBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
function jpegSeg(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...u16be(payload.length + 2), ...payload];
}

/** A minimal EXIF TIFF blob: IFD0 with Orientation (=1, normal — so a
 * successful strip leaves no APP1 at all, keeping this test's "no APP1 with
 * GPS" assertion simple) and a GPSInfo pointer to a nested GPS IFD carrying
 * a real GPS tag, so there's an actual GPS byte sequence to prove gone. */
function buildExifTiffWithGps(): number[] {
  const gpsIfdOffset = 38;
  const orientationEntry = [
    ...u16le(0x0112),
    ...u16le(3), // SHORT
    ...u32le(1),
    ...u16le(1), // orientation = normal
    ...u16le(0),
  ];
  const gpsPointerEntry = [
    ...u16le(0x8825), // GPSInfo IFD pointer
    ...u16le(4), // LONG
    ...u32le(1),
    ...u32le(gpsIfdOffset),
  ];
  const ifd0 = [
    ...u16le(2),
    ...orientationEntry,
    ...gpsPointerEntry,
    ...u32le(0),
  ];
  const header = [0x49, 0x49, 0x2a, 0x00, ...u32le(8), ...ifd0];
  const gpsIfd = [
    ...u16le(1),
    ...u16le(0x0002), // GPSLatitude
    ...u16le(5), // RATIONAL
    ...u32le(3),
    ...u32le(9999), // offset — payload doesn't need to resolve for this test
  ];
  return [...header, ...gpsIfd];
}

function buildJpegWithGps(): Uint8Array {
  const app0 = jpegSeg(0xe0, [
    ...asciiBytes("JFIF"),
    0x00,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ]);
  const app1 = jpegSeg(0xe1, [
    ...asciiBytes("Exif"),
    0x00,
    0x00,
    ...buildExifTiffWithGps(),
  ]);
  const dqt = jpegSeg(0xdb, [0x00, ...new Array(8).fill(1)]);
  const sof0 = jpegSeg(0xc0, [0x08, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  const dht = jpegSeg(0xc4, [0x00, ...new Array(16).fill(0), 0x00]);
  const sos = jpegSeg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scanData = [0x11, 0x22, 0x33, 0xff, 0x00, 0x44, 0x55];
  const eoi = [0xff, 0xd9];

  return new Uint8Array([
    0xff,
    0xd8,
    ...app0,
    ...app1,
    ...dqt,
    ...sof0,
    ...dht,
    ...sos,
    ...scanData,
    ...eoi,
  ]);
}

/** Independent re-parse (deliberately separate from `strip.ts`'s own walk)
 * of a JPEG's marker sequence before SOS. */
function listMarkersBeforeSos(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const markers: number[] = [];
  let pos = 2;
  while (pos < bytes.length) {
    const marker = view.getUint8(pos + 1);
    if (marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      markers.push(marker);
      pos += 2;
      continue;
    }
    const len = view.getUint16(pos + 2, false);
    markers.push(marker);
    pos += 2 + len;
  }
  return markers;
}

/** The SOS marker and everything after it (scan data + EOI), verbatim. */
function sosTail(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos < bytes.length) {
    const marker = view.getUint8(pos + 1);
    if (marker === 0xda) return bytes.subarray(pos);
    const len = view.getUint16(pos + 2, false);
    pos += 2 + len;
  }
  throw new Error("fixture has no SOS marker");
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
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

test.describe("strip-exif", () => {
  test("strips EXIF/GPS from a JPEG and keeps the scan data identical", async ({
    page,
  }) => {
    const input = buildJpegWithGps();
    // Sanity check on the fixture itself, before it ever touches the app.
    expect(listMarkersBeforeSos(input)).toContain(0xe1);

    await page.goto("/tools/strip-exif");

    await page.locator('input[type="file"]').setInputFiles({
      name: "gps-photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(input),
    });

    const downloadLink = page.getByRole("link", { name: "Download" });
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("download produced no local path");
    const { readFileSync } = await import("node:fs");
    const output = new Uint8Array(readFileSync(path));

    expect(hasJpegSignature(output)).toBe(true);
    expect(download.suggestedFilename()).toBe("gps-photo.jpg");

    // No APP1 at all: this fixture's EXIF has orientation 1 (normal), so a
    // correct strip drops it outright rather than writing a replacement.
    expect(listMarkersBeforeSos(output)).not.toContain(0xe1);

    // The GPSInfo IFD pointer tag (0x8825, little-endian bytes 0x25, 0x88)
    // must not survive anywhere in the output.
    let foundGps = false;
    for (let i = 0; i <= output.length - 2; i++) {
      if (output[i] === 0x25 && output[i + 1] === 0x88) {
        foundGps = true;
        break;
      }
    }
    expect(foundGps).toBe(false);

    // The scan data (the actual image payload) is never touched by
    // stripping — SOS onward must be byte-for-byte identical.
    expect(Array.from(sosTail(output))).toEqual(Array.from(sosTail(input)));
  });
});

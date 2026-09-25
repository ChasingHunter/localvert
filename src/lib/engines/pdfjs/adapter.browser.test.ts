import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { sniffFormat } from "@/lib/registry";
import { isEngineError } from "../errors";
import type { EngineInput, EngineTask } from "../types";
import adapter from "./adapter";

// pdf.js parses ~3 MB of its own JS on first `load()` (pdf.mjs + the
// pdf.worker.mjs it imports as its in-thread "fake worker" — see the
// adapter's own `load` doc comment) — well past vitest's 5s default, same
// reasoning as `libraw/adapter.browser.test.ts`'s TIMEOUT.
const TIMEOUT = 30_000;

/** The real, `pnpm sync-engines`-populated asset path — proves the adapter
 * loads pdf.mjs/pdf.worker.mjs/cmaps/standard_fonts from our own versioned
 * origin, never a CDN. See `libraw/adapter.browser.test.ts`'s `baseUrl`. */
function baseUrl(): string {
  return ENGINE_MANIFEST.pdfjs.baseUrl;
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "render",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "pdf",
    outputFormat: "png",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function bytesInput(bytes: ArrayBuffer): EngineInput {
  return { kind: "bytes", bytes };
}

/**
 * Builds a 2-page PDF with `@cantoo/pdf-lib` — a filled, known-colour
 * rectangle on each page (so a rendered pixel can be asserted on exactly)
 * plus a line of real text (so `render` exercises pdf.js's font/glyph path,
 * not just vector fills — the whole reason `disableFontFace`/
 * `useSystemFonts: false`/`standardFontDataUrl` exist in the adapter).
 * `width`/`height` are whole points so a dpi-72 render (scale 1) lands on
 * exact, assertable pixel dimensions.
 */
async function buildTestPdf(
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      color: rgb(0, 0.4, 1), // #0066ff, saturated enough to survive JPEG quantization
    });
    page.drawText(`Page ${i + 1}`, {
      x: 10,
      y: height - 30,
      size: 16,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await doc.save();
  return bytes.slice().buffer;
}

async function buildEncryptedPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.encrypt({ userPassword: "secret" });
  const bytes = await doc.save();
  return bytes.slice().buffer;
}

describe("pdfjs adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("pdfjs");
    expect(adapter.marker).toBe("localvert-engine:pdfjs");
    expect(adapter.location).toBe("static");
    expect(adapter.needsIsolation).toBe(false);
    expect(adapter.heavy).toBe(true);
  });

  describe("supports", () => {
    it("accepts render from pdf to jpg or png", () => {
      expect(adapter.supports("render", "pdf", "jpg")).toBe(true);
      expect(adapter.supports("render", "pdf", "png")).toBe(true);
    });

    it("rejects a non-render op", () => {
      expect(adapter.supports("decode", "pdf", "png")).toBe(false);
    });

    it("rejects a non-pdf input", () => {
      expect(adapter.supports("render", "jpg", "png")).toBe(false);
    });

    it("rejects a non-image output", () => {
      expect(adapter.supports("render", "pdf", "pdf")).toBe(false);
    });
  });

  describe("run", () => {
    it(
      "renders every page to png, one file each, at the page's own pt size for dpi 72",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(200, 300);

        // No `dpi` option set — the adapter's own default (150) — so this
        // also proves the default independently of the explicit-dpi test
        // below by asking for 72 explicitly, where scale is exactly 1 and
        // page pt size and pixel size coincide.
        const result = await instance.run(
          baseTask({
            input: bytesInput(pdf),
            options: { dpi: 72 },
          }),
        );
        if (result.kind !== "files") throw new Error("expected files result");

        expect(result.files.map((f) => f.name)).toEqual([
          "document-page-1.png",
          "document-page-2.png",
        ]);
        for (const file of result.files) {
          expect(file.mime).toBe("image/png");
          expect(sniffFormat(new Uint8Array(file.bytes))).toBe("png");
        }

        const bitmap = await createImageBitmap(
          new Blob([result.files[0]?.bytes ?? new ArrayBuffer(0)], {
            type: "image/png",
          }),
        );
        try {
          expect(bitmap.width).toBe(200);
          expect(bitmap.height).toBe(300);
        } finally {
          bitmap.close();
        }
      },
      TIMEOUT,
    );

    it(
      "names output files from the input blob's own filename",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(100, 100);

        const result = await instance.run(
          baseTask({
            input: {
              kind: "blob",
              blob: new File([pdf], "report.pdf", {
                type: "application/pdf",
              }),
            },
            options: { pages: "1" },
          }),
        );
        if (result.kind !== "files") throw new Error("expected files result");
        expect(result.files.map((f) => f.name)).toEqual(["report-page-1.png"]);
      },
      TIMEOUT,
    );

    it(
      "renders a known pixel colour inside the drawn rectangle",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(100, 100);

        const result = await instance.run(
          baseTask({
            input: bytesInput(pdf),
            options: { dpi: 72, pages: "1" },
          }),
        );
        if (result.kind !== "files") throw new Error("expected files result");
        const file = result.files[0];
        if (!file) throw new Error("expected one file");

        const bitmap = await createImageBitmap(
          new Blob([file.bytes], { type: "image/png" }),
        );
        try {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no 2d context in test setup");
          ctx.drawImage(bitmap, 0, 0);
          // The rectangle is drawn at PDF (x:10, y:10, 40x40) in a bottom-left
          // origin; canvas pixels are top-left origin, so its centre
          // (30, 30 in PDF space) lands at (30, height-30) in pixel space.
          const { data } = ctx.getImageData(30, bitmap.height - 30, 1, 1);
          expect(Array.from(data)).toEqual([0x00, 0x66, 0xff, 255]);
        } finally {
          bitmap.close();
        }
      },
      TIMEOUT,
    );

    it(
      "renders to jpg with real jpg magic bytes",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(100, 100);

        const result = await instance.run(
          baseTask({
            input: bytesInput(pdf),
            outputFormat: "jpg",
            options: { pages: "1", quality: 0.9 },
          }),
        );
        if (result.kind !== "files") throw new Error("expected files result");
        const file = result.files[0];
        if (!file) throw new Error("expected one file");
        expect(file.mime).toBe("image/jpeg");
        expect(sniffFormat(new Uint8Array(file.bytes))).toBe("jpg");
      },
      TIMEOUT,
    );

    it(
      '"pages" selects a subset — "2" produces exactly one file, for the second page',
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(120, 120);

        const result = await instance.run(
          baseTask({
            input: bytesInput(pdf),
            options: { pages: "2" },
          }),
        );
        if (result.kind !== "files") throw new Error("expected files result");
        expect(result.files.map((f) => f.name)).toEqual([
          "document-page-2.png",
        ]);
      },
      TIMEOUT,
    );

    it(
      "throws EngineError('unsupported') for a password-protected PDF",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const encrypted = await buildEncryptedPdf();

        await expect(
          instance.run(baseTask({ input: bytesInput(encrypted) })),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "unsupported",
        );
      },
      TIMEOUT,
    );

    it(
      "throws EngineError('aborted') when the signal is already aborted",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(100, 100);
        const controller = new AbortController();
        controller.abort();

        await expect(
          instance.run(
            baseTask({ input: bytesInput(pdf), signal: controller.signal }),
          ),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "aborted",
        );
      },
      TIMEOUT,
    );

    it(
      "never requests anything off this origin — no CDN, everything from ctx.baseUrl",
      async () => {
        // A resource-timing check, not a full network intercept (Playwright
        // e2e already covers that at the whole-app level — see
        // `e2e/pdf.spec.ts`'s `privacyGuard`): this is an adapter-level
        // cross-check that `load()`'s runtime imports and `getDocument()`'s
        // cmap/font URLs never resolve off-origin, even in isolation from
        // the rest of the app.
        performance.clearResourceTimings();
        const instance = await adapter.load({
          baseUrl: baseUrl(),
          capabilities: {} as never,
        });
        const pdf = await buildTestPdf(100, 100);
        await instance.run(baseTask({ input: bytesInput(pdf) }));

        const foreign = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => new URL(url).origin !== location.origin);
        expect(foreign).toEqual([]);
      },
      TIMEOUT,
    );
  });
});

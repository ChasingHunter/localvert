"use client";

import { useEffect, useState } from "react";
import { createPdfiumWorkerEngine } from "@/lib/editor/pdfium-engine";

/**
 * E0b spike page — NOT a registered tool, never linked from the app. Proves
 * (or disproves) the PDFium-in-our-own-worker wiring end to end: open a
 * fixture PDF, render page 1, add a highlight, redact a secret, export, and
 * expose every step's outcome as plain text + `data-testid`s so a throwaway
 * Playwright script can assert on it without guessing at timing. See
 * docs/editor/EMBEDPDF_NOTES.md and the E0b brief for the exact criteria
 * this exists to check.
 *
 * `@cantoo/pdf-lib` and `@embedpdf/models`'s enum are dynamically imported
 * inside the effect below, not statically at module scope — a static import
 * pushed this page's own first-load JS chunk to 518 KB gz, over the 300 KB
 * budget `check-sizes` enforces on every page (not just the shared core
 * chunk). This is a real spike finding, noted in EMBEDPDF_NOTES.md: a
 * shipped editor tool will need the same lazy-import discipline the job
 * pipeline already uses for engines.
 */

const SECRET = "SECRET-4711";

async function buildFixture(): Promise<ArrayBuffer> {
  const { PDFDocument, rgb, StandardFonts } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("public information", {
    x: 50,
    y: 200,
    size: 18,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText(SECRET, { x: 50, y: 150, size: 18, font, color: rgb(0, 0, 0) });
  const bytes = await doc.save();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

type Status = { step: string; ok: boolean; detail?: string };

export default function PdfEditorSpike() {
  const [log, setLog] = useState<Status[]>([]);
  const [pageImage, setPageImage] = useState<{
    data: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
  } | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const steps: Status[] = [];
    const record = (step: string, ok: boolean, detail?: string) => {
      steps.push({ step, ok, detail });
      if (!cancelled) setLog([...steps]);
    };

    async function run() {
      const { PdfAnnotationSubtype } = await import("@embedpdf/models");
      const { engine, terminate } = createPdfiumWorkerEngine();
      try {
        const fixture = await buildFixture();
        record("fixture-built", true);

        const doc = await engine
          .openDocumentBuffer({ id: "spike", content: fixture })
          .toPromise();
        record("open-document", true, `pages=${doc.pageCount}`);

        const page = doc.pages[0];
        if (!page) throw new Error("no pages in fixture");
        // renderPageRaw, not renderPage: see the note in pdfium.worker.ts —
        // the direct engine's Blob-producing methods need `document`, which
        // does not exist inside this worker. Raw pixels are drawn to a
        // <canvas> on the main thread instead (invariant 2: DOM stays
        // there).
        const raw = await engine.renderPageRaw(doc, page).toPromise();
        if (!cancelled) {
          setPageImage({
            data: raw.data,
            width: raw.width,
            height: raw.height,
          });
        }
        record("render-page", true, `${raw.width}x${raw.height}`);

        await engine
          .createPageAnnotation(doc, page, {
            type: PdfAnnotationSubtype.HIGHLIGHT,
            id: "hl-1",
            pageIndex: 0,
            rect: {
              origin: { x: 50, y: 190 },
              size: { width: 150, height: 22 },
            },
            segmentRects: [
              { origin: { x: 50, y: 190 }, size: { width: 150, height: 22 } },
            ],
            opacity: 1,
            strokeColor: "#ffff00",
          })
          .toPromise();
        record("add-highlight", true);

        const rects = await engine.getPageTextRects(doc, page).toPromise();
        const secretRect = rects.find((r) => r.content.includes(SECRET))?.rect;
        if (!secretRect) throw new Error("secret rect not found");
        await engine
          .redactTextInRects(doc, page, [secretRect], { drawBlackBoxes: true })
          .toPromise();
        record("redact-secret", true);

        const exported = await engine.saveAsCopy(doc).toPromise();
        record("export", true, `bytes=${exported.byteLength}`);

        // Criterion (e): redacted text must be gone from raw exported bytes.
        const exportedLatin1 = new TextDecoder("latin1").decode(exported);
        const redactedFromRaw = !exportedLatin1.includes(SECRET);
        record("redaction-verified-raw-bytes", redactedFromRaw);

        if (!cancelled) {
          setExportUrl(
            URL.createObjectURL(
              new Blob([exported], { type: "application/pdf" }),
            ),
          );
        }
      } catch (e) {
        record("failed", false, e instanceof Error ? e.message : String(e));
      } finally {
        terminate();
        if (!cancelled) setDone(true);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PdfEditorSpikeView
      log={log}
      pageImage={pageImage}
      exportUrl={exportUrl}
      done={done}
    />
  );
}

function PdfEditorSpikeView({
  log,
  pageImage,
  exportUrl,
  done,
}: {
  log: Status[];
  pageImage: {
    data: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
  } | null;
  exportUrl: string | null;
  done: boolean;
}) {
  const canvasRef = (node: HTMLCanvasElement | null) => {
    if (!node || !pageImage) return;
    node.width = pageImage.width;
    node.height = pageImage.height;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const imageData = new ImageData(
      pageImage.data,
      pageImage.width,
      pageImage.height,
    );
    ctx.putImageData(imageData, 0, 0);
  };

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>E0b PDFium worker spike</h1>
      <ul data-testid="log">
        {log.map((s) => (
          <li key={s.step} data-testid={`step-${s.step}`} data-ok={s.ok}>
            {s.ok ? "OK" : "FAIL"} {s.step} {s.detail ?? ""}
          </li>
        ))}
      </ul>
      <div data-testid="done" data-done={done}>
        {done ? "done" : "running"}
      </div>
      {pageImage && (
        <canvas data-testid="page1" ref={canvasRef} aria-label="page 1" />
      )}
      {exportUrl && (
        <a data-testid="export-link" href={exportUrl} download="spike.pdf">
          download exported pdf
        </a>
      )}
    </main>
  );
}

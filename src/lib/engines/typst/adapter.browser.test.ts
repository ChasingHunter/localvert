import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { createWorkerPool } from "@/lib/workers/pool";
import { spawnEngineWorker } from "@/lib/workers/spawn";

/**
 * Real worker, real wasm, real gzip decompression, real CSP-patched glue
 * (ADR-0011) — this is the only place the typst engine is exercised the way
 * production actually dispatches it: through `createWorkerPool`/
 * `spawnEngineWorker`, exactly what `job-engine.ts` and the tool-runner UI
 * use, rather than calling `adapter.load()`/`run()` directly on the test's
 * own thread (compare `libraw`/`pdfjs`'s `adapter.browser.test.ts`, which do
 * call the adapter directly — typst gets the worker-pool treatment instead
 * because the whole point of this suite is proving the *patched glue* (a
 * `new Function` replaced with a static lookup, see
 * `scripts/sync-engines.ts`'s `patchTypstGlue`) still produces a correct
 * PDF when it runs the way a real conversion does).
 *
 * The compiler wasm decompresses from ~10 MB gzipped to ~28 MB and then
 * itself compiles a small document — comfortably past vitest's 5s default.
 */
const TIMEOUT = 30_000;

const SAMPLE_MARKDOWN = `# Sample document

This is a **sample** markdown file for the typst engine's real-worker test.

- first item
- second item
- third item

| Column A | Column B |
| -------- | -------- |
| alpha    | beta     |
| gamma    | delta    |

\`\`\`
console.log("hello from a code block");
\`\`\`

[a link](https://example.com)
`;

function hasPdfMagic(bytes: Uint8Array): boolean {
  const magic = String.fromCharCode(...bytes.subarray(0, 5));
  return magic === "%PDF-";
}

/** pdf.js is a plain library import here (not our `pdfjs` engine adapter,
 * which only supports `render` to a raster, not text extraction) — used
 * purely as this test's own oracle to prove the produced PDF really
 * contains the markdown's content, not just a well-formed empty document. */
async function extractText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // `?url` (Vite, same as this file's own transitive Vitest browser-mode
  // bundler): this test's own oracle needs pdf.js's worker script the same
  // way `pdfjs/adapter.ts`'s real `load()` needs one — pdf.js refuses to run
  // without a `workerSrc` at all, worker or no.
  // @ts-expect-error — a Vite `?url` import has no ambient module
  // declaration in this repo (nothing else imports pdf.js's worker this
  // way outside its own adapter, which gets its copy via `sync-engines`
  // instead — see the doc comment above).
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url"))
    .default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
  }
  return text;
}

describe("typst engine (real worker)", () => {
  it(
    "compiles markdown (heading, list, table, code, link) to a real PDF, no eval",
    async () => {
      const pool = createWorkerPool({
        size: 1,
        spawn: spawnEngineWorker,
        isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
      });

      try {
        const markdownBlob = new Blob([SAMPLE_MARKDOWN], {
          type: "text/markdown",
        });

        const result = await pool.run({
          jobId: "typst-browser-test-1",
          input: { kind: "blob", blob: markdownBlob },
          steps: [
            {
              engine: "typst",
              baseUrl: ENGINE_MANIFEST.typst.baseUrl,
              op: "transcode",
              inputFormat: "md",
              outputFormat: "pdf",
            },
          ],
          options: { pageSize: "a4", fontSize: "11" },
        });

        if (result.kind !== "bytes") {
          throw new Error("expected a bytes result");
        }
        const pdfBytes = new Uint8Array(result.bytes);
        expect(hasPdfMagic(pdfBytes)).toBe(true);

        const text = await extractText(pdfBytes);
        expect(text).toContain("Sample document");
        expect(text).toContain("first item");
        expect(text).toContain("alpha");
        expect(text).toContain("beta");
      } finally {
        pool.destroy();
      }
    },
    TIMEOUT,
  );
});

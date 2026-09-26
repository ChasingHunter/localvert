import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * OCR, not the raster pipeline (ADR-0007): the `tesseract` engine decodes
 * the image itself (tesseract.js's own `loadImage`), so this is a single
 * byte-to-byte-ish step (image bytes -> text bytes) like `strip-exif`, not a
 * `decode`/`encode` pair. No declared pipeline `from`/`to`, same reasoning
 * as `strip-exif.ts`/`images-to-pdf.ts`: `accepts` lists several formats, so
 * there's no one fixed input format to declare — it falls back to
 * `job-engine.ts`'s (this file's sniffed format -> `produces`).
 *
 * `language` is a `select` with a single option today — `eng` is the only
 * language pack this engine ships (`src/lib/engines/tesseract/engine.json`).
 * Kept as a real (if currently unary) option rather than hardcoded so a
 * future language pack is a data change here, not a new tool.
 */
export default defineTool({
  slug: "image-to-text",
  category: "image",
  title: "Image to Text (OCR)",
  description:
    "Extract text from photos and scans with OCR, privately in your " +
    "browser. Free and private: no upload, works offline once loaded.",

  accepts: ["jpg", "png", "webp", "bmp"],
  produces: "txt",

  options: z.object({
    language: z
      .enum(["eng"])
      .meta({ label: "Language", control: "select" })
      .default("eng"),
  }),
  defaults: { language: "eng" },

  pipeline: [{ op: "ocr", candidates: [{ engine: "tesseract" }] }],

  batch: true,
});

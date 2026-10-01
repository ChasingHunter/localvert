import type { ToolDefinition } from "@/lib/registry/types";

/**
 * The PDF hub (`/pdf`, `docs/adr` positioning research 2026-09-28) groups
 * PDF tools the way the big PDF suites do, instead of one flat list. This
 * is deliberately a small hand-written slug -> group map rather than a field
 * on `ToolDefinition`: only the hub page cares about this grouping, and
 * `src/lib/pdf-hub.test.ts` pins that every PDF-facing tool lands in exactly
 * one group. Covers every `category: "pdf"` tool plus the office/markup ->
 * PDF conversions that live under `category: "document"` (word-to-pdf and
 * friends) — the hub's "Convert" group is meant to answer "how do I get a
 * PDF out of or into anything", which crosses that category boundary.
 */
export const PDF_HUB_GROUPS = [
  "organize",
  "optimize",
  "convert",
  "edit",
  "security",
] as const;

export type PdfHubGroup = (typeof PDF_HUB_GROUPS)[number];

export const PDF_HUB_GROUP_LABELS: Record<PdfHubGroup, string> = {
  organize: "Organize",
  optimize: "Optimize",
  convert: "Convert",
  edit: "Edit",
  security: "Security",
};

export const PDF_HUB_GROUP_BY_SLUG: Record<string, PdfHubGroup> = {
  // Organize
  "merge-pdf": "organize",
  "split-pdf": "organize",
  "reorder-pdf-pages": "organize",
  "delete-pdf-pages": "organize",
  "extract-pdf-pages": "organize",
  "rotate-pdf": "organize",

  // Optimize
  "compress-pdf": "optimize",
  "flatten-pdf": "optimize",
  "sanitize-pdf": "optimize",

  // Convert (to/from PDF)
  "pdf-to-word": "convert",
  "pdf-to-text": "convert",
  "pdf-to-jpg": "convert",
  "pdf-to-png": "convert",
  "jpg-to-pdf": "convert",
  "png-to-pdf": "convert",
  "heic-to-pdf": "convert",
  "tiff-to-pdf": "convert",
  "images-to-pdf": "convert",
  "word-to-pdf": "convert",
  "excel-to-pdf": "convert",
  "powerpoint-to-pdf": "convert",
  "markdown-to-pdf": "convert",
  "html-to-pdf": "convert",
  "epub-to-pdf": "convert",
  "txt-to-pdf": "convert",

  // Edit
  "pdf-editor": "edit",
  "watermark-pdf": "edit",
  "add-page-numbers": "edit",
  "pdf-to-searchable-pdf": "edit",
  "image-to-searchable-pdf": "edit",

  // Security
  "protect-pdf": "security",
  "unlock-pdf": "security",
};

/**
 * Buckets `tools` into the hub's five groups, in `PDF_HUB_GROUPS` order,
 * preserving each tool's order within its group. A tool with no entry in
 * `PDF_HUB_GROUP_BY_SLUG` (anything outside the PDF hub's scope) is skipped.
 */
export function groupPdfHubTools(
  tools: readonly ToolDefinition[],
): Map<PdfHubGroup, ToolDefinition[]> {
  const groups = new Map<PdfHubGroup, ToolDefinition[]>();
  for (const group of PDF_HUB_GROUPS) groups.set(group, []);
  for (const tool of tools) {
    const group = PDF_HUB_GROUP_BY_SLUG[tool.slug];
    if (!group) continue;
    groups.get(group)?.push(tool);
  }
  return groups;
}

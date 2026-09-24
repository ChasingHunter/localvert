/**
 * The six top-level groupings a tool belongs to. Drives routing
 * (`/category/slug`), the category index pages, and per-category
 * concurrency — see `CATEGORY_META.concurrency` and
 * docs/ARCHITECTURE.md#concurrency-and-memory.
 */
export const CATEGORIES = [
  "image",
  "video",
  "audio",
  "pdf",
  "document",
  "archive",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CategoryMeta {
  label: string;
  description: string;
  /**
   * "pool" runs jobs across the whole worker pool; "single" runs one at a
   * time. Video, audio and document conversions already saturate CPU and
   * memory per job, so they get "single" — see
   * docs/ARCHITECTURE.md#concurrency-and-memory.
   */
  concurrency: "pool" | "single";
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  image: {
    label: "Image",
    description: "Convert, resize and compress photos and graphics.",
    concurrency: "pool",
  },
  video: {
    label: "Video",
    description: "Convert, trim and compress video files.",
    concurrency: "single",
  },
  audio: {
    label: "Audio",
    description: "Convert and re-encode audio tracks.",
    concurrency: "single",
  },
  pdf: {
    label: "PDF",
    description: "Merge, split and convert PDF documents.",
    concurrency: "pool",
  },
  document: {
    label: "Document",
    description: "Convert office documents and text formats.",
    concurrency: "single",
  },
  archive: {
    label: "Archive",
    description: "Zip, unzip and compress file archives.",
    concurrency: "pool",
  },
};

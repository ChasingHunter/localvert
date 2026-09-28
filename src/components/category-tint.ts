import type { Category } from "@/lib/registry/categories";

/**
 * ADR-0016's category tints, as literal Tailwind class strings. Literal,
 * not `` `bg-cat-${category}` `` — Tailwind's build-time scanner only
 * catches class names it can see verbatim in source, so a template-built
 * name would never make it into the generated CSS. Text always stays
 * `text-ink` on the tint (the ADR: "text never goes in the tint colour
 * itself"), each pair checked at WCAG AA in the redesign's contrast pass.
 *
 * Used both for a chip's tinted background and for the small dot next to a
 * category heading — same colour, different-sized `bg-cat-*` element.
 */
export const CATEGORY_TINT_BG: Record<Category, string> = {
  image: "bg-cat-image",
  video: "bg-cat-video",
  audio: "bg-cat-audio",
  pdf: "bg-cat-pdf",
  document: "bg-cat-document",
  archive: "bg-cat-archive",
  data: "bg-cat-data",
};

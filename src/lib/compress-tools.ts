/**
 * The compress tools in the order the /compress page lists them (and the
 * header's Compress menu, so the two never disagree). Hand-written rather
 * than derived from a `compress-*` naming convention, so a tool that merely
 * starts with "compress" is never picked up by accident.
 */
export const COMPRESS_SLUGS = [
  "compress-jpg",
  "compress-png",
  "compress-webp",
  "compress-pdf",
  "compress-video",
  "compress-audio",
] as const;

/** `tools` narrowed to the compress ones, in `COMPRESS_SLUGS` order. */
export function orderedCompressors<T extends { slug: string }>(
  tools: readonly T[],
): T[] {
  return COMPRESS_SLUGS.map((slug) =>
    tools.find((tool) => tool.slug === slug),
  ).filter((tool): tool is T => tool !== undefined);
}

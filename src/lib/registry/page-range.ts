/**
 * ADR-0008: the one page-selection parser every PDF tool with a `pages`
 * option shares, so "1-3, 5, 8-" means the same thing everywhere instead of
 * each tool inventing its own dialect. Pure — no PDF parsing here, just the
 * spec string plus the document's own page count.
 */

const TOKEN_RE = /^(\d+)(?:-(\d+)?)?$/;

function fail(message: string): never {
  throw new Error(`[page-range] ${message}`);
}

function outOfRange(page: number, token: string, pageCount: number): never {
  fail(
    `page ${page} is out of range in "${token}" (this document has ${pageCount} page${pageCount === 1 ? "" : "s"})`,
  );
}

/**
 * Parses a page-range spec into 0-based page indices, validated against
 * `pageCount`. `""` and `"all"` (case-insensitive) mean every page. Commas
 * separate tokens: a bare number ("5"), a closed range ("1-3"), or an
 * open-ended range ("8-", meaning 8 through the last page). Ranges are
 * inclusive and 1-based on input, matching how a user would type page
 * numbers. Duplicate pages (from overlapping tokens) are dropped, keeping
 * each page's first occurrence — so "3, 1-3" yields `[2, 0, 1]`, page order
 * as the user asked for it, not sorted.
 *
 * Throws with a clear message for a malformed token, a page number below 1,
 * or above `pageCount`.
 */
export function parsePageRange(spec: string, pageCount: number): number[] {
  if (pageCount < 1) {
    fail(`pageCount must be at least 1, got ${pageCount}`);
  }

  const trimmed = spec.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "all") {
    return Array.from({ length: pageCount }, (_, i) => i);
  }

  const seen = new Set<number>();
  const indices: number[] = [];

  for (const rawToken of trimmed.split(",")) {
    // Trims the token itself, and any space around a range's own "-" (so
    // "1 - 3" reads the same as "1-3") — everywhere else, whitespace inside
    // a token is left alone and fails the regex below like any other
    // malformed input.
    const token = rawToken.trim().replace(/\s*-\s*/g, "-");
    if (token === "") {
      fail(`invalid page range "${spec}" — empty entry between commas`);
    }

    const match = TOKEN_RE.exec(token);
    if (!match) {
      fail(
        `invalid page range "${token}" — expected a page number or a range like "1-3" or "8-"`,
      );
    }

    const [, startStr, endStr] = match;
    const start = Number(startStr);
    if (start < 1 || start > pageCount) {
      outOfRange(start, token, pageCount);
    }

    // No "-" at all: a bare page number, e.g. "5".
    if (!token.includes("-")) {
      if (!seen.has(start - 1)) {
        seen.add(start - 1);
        indices.push(start - 1);
      }
      continue;
    }

    // "8-" (endStr is "" or undefined) means through the last page.
    const end =
      endStr === undefined || endStr === "" ? pageCount : Number(endStr);
    if (end < start) {
      fail(`invalid page range "${token}" — end is before start`);
    }
    if (end > pageCount) {
      outOfRange(end, token, pageCount);
    }

    for (let n = start; n <= end; n++) {
      const index = n - 1;
      if (!seen.has(index)) {
        seen.add(index);
        indices.push(index);
      }
    }
  }

  return indices;
}

const ORDER_TOKEN_RE = /^(\d+)(?:-(\d+))?$/;

/**
 * Parses a page-*order* spec for `reorder-pdf-pages`: a comma-separated list
 * of page numbers and ranges, same 1-based/inclusive token grammar as
 * `parsePageRange`'s "1-3, 5" — but a deliberately different contract, so
 * this is its own function rather than a `parsePageRange` option:
 *
 * - **Duplicates are kept, not deduped.** Repeating a page is how you
 *   duplicate it in the output (e.g. "1, 1, 2" — page 1 appears twice) — a
 *   legitimate reorder-tool use `parsePageRange`'s single-copy-per-page
 *   contract (every other pdf-lib tool) can't express.
 * - **A range may run backwards** ("6-4" = pages 6, 5, 4, in that order) —
 *   reordering is exactly the operation where "backwards" is a meaningful,
 *   intentional request, unlike `rotate`/`extract`/`split`'s ranges, which
 *   only ever select a set of pages.
 * - **No open-ended range** ("8-"): with duplicates allowed and no implied
 *   sort, "the rest of the document" has no well-defined position to land
 *   at, so it isn't supported — every page must be named explicitly.
 *
 * `""` (and `"all"`) means "unchanged": every page, in its original order,
 * with nothing dropped or duplicated — the empty-input default `reorder-pdf-
 * pages` ships with. Every named page number must exist in the document
 * (1..pageCount); a page simply left out of the spec is dropped from the
 * output, same as `extract`'s "keep" mode.
 */
export function parsePageOrder(spec: string, pageCount: number): number[] {
  if (pageCount < 1) {
    fail(`pageCount must be at least 1, got ${pageCount}`);
  }

  const trimmed = spec.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "all") {
    return Array.from({ length: pageCount }, (_, i) => i);
  }

  const indices: number[] = [];

  for (const rawToken of trimmed.split(",")) {
    const token = rawToken.trim().replace(/\s*-\s*/g, "-");
    if (token === "") {
      fail(`invalid page order "${spec}" — empty entry between commas`);
    }

    const match = ORDER_TOKEN_RE.exec(token);
    if (!match) {
      fail(
        `invalid page order "${token}" — expected a page number or a range like "1-3" or "6-4"`,
      );
    }

    const [, startStr, endStr] = match;
    const start = Number(startStr);
    if (start < 1 || start > pageCount) {
      outOfRange(start, token, pageCount);
    }

    // No "-" at all: a bare page number, e.g. "5".
    if (endStr === undefined) {
      indices.push(start - 1);
      continue;
    }

    const end = Number(endStr);
    if (end < 1 || end > pageCount) {
      outOfRange(end, token, pageCount);
    }

    // Forwards or backwards, inclusive of both ends — unlike
    // `parsePageRange`, a reversed range ("6-4") is a valid, intentional
    // request here rather than an error.
    if (start <= end) {
      for (let n = start; n <= end; n++) indices.push(n - 1);
    } else {
      for (let n = start; n >= end; n--) indices.push(n - 1);
    }
  }

  return indices;
}

/**
 * ADR-0015: pure helpers over the generated tool catalog
 * (`src/tools/catalog.ts`), for the universal "from -> to" converter. These
 * never import the `TOOLS` barrel (`src/tools/index.ts`) — that carries
 * every tool's zod schema and pipeline, which the home page's converter
 * island must not pay for (see the ADR's "Data: a generated catalog, not
 * the registry"). Only `CATALOG` and the plain-data `FORMATS`/`CATEGORIES`
 * tables are imported here.
 */

import {
  CATEGORIES,
  CATEGORY_META,
  type Category,
} from "@/lib/registry/categories";
import {
  FORMATS,
  type FormatId,
  type FormatSpec,
} from "@/lib/registry/formats";
import { CATALOG, type CatalogEntry } from "@/tools/catalog";

/**
 * A row in a from/to picker's option list — either a format ("Word (.docx)")
 * or a same-format action ("Compress"). `variant` is set only on a losing
 * candidate shown alongside a group's default (see `targetsFor`'s doc
 * comment) — its value is the whole displayed label for that row, not a
 * suffix appended to anything else.
 */
export interface Target {
  kind: "format" | "action";
  label: string;
  slug: string;
  format?: FormatId;
  variant?: string;
  /** Option values to open `slug` with, for a `producesAlso` row. */
  preset?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The picker's id for a target: its slug, plus the preset as a query string
 * when it has one (`extract-audio?format=wav`), so two rows for the same
 * tool stay distinct. `splitTargetKey` is the inverse.
 */
export function targetKey(t: Pick<Target, "slug" | "preset">): string {
  if (!t.preset) return t.slug;
  const query = new URLSearchParams(
    Object.entries(t.preset).map(([k, v]) => [k, String(v)]),
  );
  return `${t.slug}?${query.toString()}`;
}

/** Splits a `targetKey` back into the tool slug and its preset (string
 * values only; the tool's own option schema coerces them on use). */
export function splitTargetKey(key: string): {
  slug: string;
  preset?: Record<string, string>;
} {
  const at = key.indexOf("?");
  if (at === -1) return { slug: key };
  return {
    slug: key.slice(0, at),
    preset: Object.fromEntries(new URLSearchParams(key.slice(at + 1))),
  };
}

/** A `Target` plus the input format it's reachable from — what `popular()`
 * returns, since a Popular chip needs both ends of the pair to render
 * ("PDF to Word", not just "Word"). `title` is the tool's own catalog
 * title ("JPG to PNG", "Compress PDF") — already the short, chip-ready
 * form for every ranked tool, so the chip uses it directly instead of
 * recomposing a label from `FORMATS` (which would read "JPEG to PNG"). */
export interface PopularEntry extends Target {
  from: FormatId;
  rank: number;
  title: string;
}

/**
 * Verb labels for same-format "action" tools, keyed by slug — a tool's own
 * title ("Add Page Numbers to PDF", "Password Protect PDF") reads fine as a
 * page heading but is too long and too repetitive-with-the-format for a
 * from/to picker's option list, where the input format is already chosen.
 * Kept as a small explicit map (title-derivation would need to special-case
 * almost every entry anyway) rather than a derivation rule.
 */
const ACTION_LABELS: Record<string, string> = {
  "compress-audio": "Compress",
  "compress-video": "Compress",
  "compress-jpg": "Compress",
  "compress-png": "Compress",
  "compress-webp": "Compress",
  "compress-pdf": "Compress",
  "crop-jpg": "Crop",
  "crop-png": "Crop",
  "crop-webp": "Crop",
  "resize-image-jpg": "Resize",
  "resize-image-png": "Resize",
  "resize-image-webp": "Resize",
  "resize-video": "Resize",
  "rotate-jpg": "Rotate",
  "rotate-png": "Rotate",
  "rotate-webp": "Rotate",
  "rotate-video": "Rotate",
  "rotate-pdf": "Rotate",
  "strip-exif": "Strip metadata",
  "trim-video": "Trim",
  "mute-video": "Mute",
  "merge-pdf": "Merge",
  "split-pdf": "Split",
  "watermark-pdf": "Watermark",
  "add-page-numbers": "Add page numbers",
  "pdf-editor": "Edit PDF",
  "protect-pdf": "Password protect",
  "unlock-pdf": "Unlock",
  "sanitize-pdf": "Sanitize",
  "flatten-pdf": "Flatten",
  "reorder-pdf-pages": "Reorder pages",
  "delete-pdf-pages": "Delete pages",
  "extract-pdf-pages": "Extract pages",
  "pdf-to-searchable-pdf": "Make searchable (OCR)",
};

/**
 * A same-format action's spot in the To list before an unranked, generic
 * "most reached for" ordering falls back to alphabetical (ADR-0016's design
 * review: "Compress first", the Actions group scrollable but its first rows
 * the most useful ones). Applies across every category — a label absent
 * here (e.g. "Password protect") just sorts after all of these, still
 * alphabetically among itself.
 */
const ACTION_PRIORITY: readonly string[] = [
  "Compress",
  "Merge",
  "Rotate",
  "Split",
  "Crop",
  "Resize",
  "Trim",
  "Edit PDF",
];

function actionPriorityIndex(label: string): number {
  const index = ACTION_PRIORITY.indexOf(label);
  return index === -1 ? ACTION_PRIORITY.length : index;
}

/**
 * Labels for a conversion tool that is kept as a *variant* alongside a
 * group's default target, keyed by slug — see `targetsFor`'s doc comment.
 * A tool absent from this map is never shown as a variant: when it loses a
 * group's default pick, it's dropped as a redundant duplicate instead (see
 * that same doc comment for why `images-to-pdf` and `extract-audio` are
 * deliberately absent).
 */
const VARIANT_LABELS: Record<string, string> = {
  "image-to-searchable-pdf": "Searchable PDF (OCR)",
};

/** `tool.produces` resolved against a concrete input format — `"same"`
 * becomes whatever `from` actually is. */
function producedFormat(tool: CatalogEntry, from: FormatId): FormatId {
  return tool.produces === "same" ? from : (tool.produces as FormatId);
}

function actionLabelFor(tool: CatalogEntry): string {
  return ACTION_LABELS[tool.slug] ?? tool.title;
}

function formatLabelFor(format: FormatId): string {
  return FORMATS[format].label;
}

/**
 * Every format at least one non-app tool accepts, grouped by category in
 * `CATEGORIES` order (within a category, `FORMATS` declaration order). An
 * app tool (e.g. `pdf-editor`) doesn't count on its own — see
 * `ToolDefinition.kind`'s doc comment — though every format an app tool
 * accepts today is also accepted by plenty of ordinary tools.
 */
export function inputFormats(): { category: Category; formats: FormatId[] }[] {
  const accepted = new Set<FormatId>();
  for (const tool of CATALOG) {
    if (tool.kind === "app") continue;
    for (const format of tool.accepts) accepted.add(format);
  }

  const allFormats = Object.keys(FORMATS) as FormatId[];
  const groups: { category: Category; formats: FormatId[] }[] = [];
  for (const category of CATEGORIES) {
    const formats = allFormats.filter(
      (f) => FORMATS[f].category === category && accepted.has(f),
    );
    if (formats.length > 0) groups.push({ category, formats });
  }
  return groups;
}

/**
 * Why a category page's From picker also offers a format outside its own
 * category — e.g. the audio tools that pull a soundtrack out of a video
 * file. Keyed by the target category page; only entries a category's own
 * tools genuinely `accepts` show up here (`inputFormatsForCategory` derives
 * the set, this only supplies the group's label). A category with no cross
 * acceptance today (image, video, document, archive, data) has no entry and
 * never needs one — nothing computed elsewhere depends on this map being
 * exhaustive.
 */
const CROSS_CATEGORY_LABEL: Partial<Record<Category, string>> = {
  audio: "Video (extract the audio)",
  pdf: "Image (create a PDF)",
  document: "Spreadsheet (create a PDF)",
};

/**
 * Every format at least one *category-`category`* tool accepts, grouped by
 * the format's own category — its own category's formats first, then any
 * cross-category ones (`CROSS_CATEGORY_LABEL`), each in `CATEGORIES` order.
 * This is what scopes a category page's From picker and drop area to that
 * category's own tools (the bug this exists to fix: a category page must
 * never just show `inputFormats()`'s full, every-category list). An app
 * tool doesn't count on its own — same rule as `inputFormats()`.
 */
export function inputFormatsForCategory(
  category: Category,
): { category: Category; label: string; formats: FormatId[] }[] {
  const accepted = new Set<FormatId>();
  for (const tool of CATALOG) {
    if (tool.kind === "app" || tool.category !== category) continue;
    for (const format of tool.accepts) accepted.add(format);
  }

  const allFormats = Object.keys(FORMATS) as FormatId[];
  const orderedCategories = [
    category,
    ...CATEGORIES.filter((c) => c !== category),
  ];
  const groups: { category: Category; label: string; formats: FormatId[] }[] =
    [];
  for (const groupCategory of orderedCategories) {
    const formats = allFormats.filter(
      (f) => FORMATS[f].category === groupCategory && accepted.has(f),
    );
    if (formats.length === 0) continue;
    const label =
      groupCategory === category
        ? CATEGORY_META[groupCategory].label
        : (CROSS_CATEGORY_LABEL[category] ??
          CATEGORY_META[groupCategory].label);
    groups.push({ category: groupCategory, label, formats });
  }
  return groups;
}

/**
 * Just `category`'s own formats out of `inputFormatsForCategory` — the
 * cross-category ones (e.g. video, on the audio page) are left out. Backs
 * the drop area's plain "Works with …" summary line (`formatsSummaryText`),
 * which is meant to read as a short, literal claim about this category, not
 * a full accept list — the disclosure under it uses the full
 * `inputFormatsForCategory` set instead.
 */
export function nativeInputFormats(category: Category): FormatId[] {
  return (
    inputFormatsForCategory(category).find((g) => g.category === category)
      ?.formats ?? []
  );
}

/** Comma-joins every item but the last, which gets "and" instead of a
 * comma — "MP3, WAV and FLAC", not "MP3, WAV, FLAC". */
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How many formats a category page's drop-area summary line names outright
 * before it falls back to "… and more." */
const SUMMARY_FORMAT_COUNT = 8;

/**
 * The drop area's "Works with …" summary line for a category page: every
 * format outright when there are few enough to read in one line, otherwise
 * the first `SUMMARY_FORMAT_COUNT` plus "and more." — the full list still
 * lives one click away, in the disclosure next to it (`acceptedFormatsLabel`
 * over `inputFormatsForCategory`'s full set, built by the caller). Returns
 * `""` for an empty list — a category page never has one, but this stays
 * total rather than asserting it.
 */
export function formatsSummaryText(formats: readonly FormatId[]): string {
  if (formats.length === 0) return "";
  const labels = formats.map((f) => FORMATS[f].label);
  if (labels.length <= SUMMARY_FORMAT_COUNT) {
    return `Works with ${joinWithAnd(labels)}.`;
  }
  return `Works with ${labels.slice(0, SUMMARY_FORMAT_COUNT).join(", ")} and more.`;
}

/**
 * Picks the one tool a `(from, to)` format pair resolves to by default, when
 * more than one tool produces `to` from `from`: lowest `rank` first (unset
 * sorts last), then the tool whose slug is the exact pair name
 * (`${from}-to-${to}`), then alphabetically by slug. Every other tool in
 * `group` either becomes a labelled variant (if it's in `VARIANT_LABELS`) or
 * is dropped — see `targetsFor`.
 */
function pickDefault(
  group: readonly CatalogEntry[],
  from: FormatId,
  to: FormatId,
): CatalogEntry {
  const exactSlug = `${from}-to-${to}`;
  return [...group].sort((a, b) => {
    const rankA = a.rank ?? Number.POSITIVE_INFINITY;
    const rankB = b.rank ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    const exactA = a.slug === exactSlug ? 0 : 1;
    const exactB = b.slug === exactSlug ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    return a.slug.localeCompare(b.slug);
  })[0] as CatalogEntry;
}

/**
 * The from/to picker's option list for a given input format: every tool
 * that accepts `from`, split into `conversions` (produces a different
 * format) and `actions` (produces the same format `from` resolves to,
 * including an app tool like `pdf-editor`).
 *
 * When several tools produce the same output format from `from`, they
 * collapse to one default target (`pickDefault`) plus, for any tool listed
 * in `VARIANT_LABELS`, a second target carrying that tool's distinguishing
 * `variant` label. A losing tool with no `VARIANT_LABELS` entry is dropped
 * entirely rather than shown as an unlabelled duplicate:
 *
 * - `jpg-to-pdf`/`png-to-pdf` vs `images-to-pdf`: `images-to-pdf`'s own doc
 *   comment (`src/tools/pdf/images-to-pdf.ts`) calls `jpg-to-pdf` its
 *   "single-format sibling ... same `merge` op ... same options" — i.e. the
 *   exact same UX for a user who already picked one input format. Showing
 *   both would just be the same button twice, so `images-to-pdf` is
 *   excluded from every `(from, "pdf")` group rather than added to
 *   `VARIANT_LABELS`. It still fully exists as a tool elsewhere (e.g. its
 *   own page, a mixed jpg+png drop) — this only concerns which single-format
 *   picker group it competes in.
 * - `mov-to-mp3`/`webm-to-mp3` vs `extract-audio`, and `mov-to-webm` vs
 *   `mp4-to-webm`: same reasoning — a generic multi-format tool competing
 *   with a specific single-pair tool for a format that pair tool already
 *   covers is a redundant duplicate, not a meaningfully different variant.
 *   `extract-audio` is still the sole (and therefore default) target for a
 *   format with no dedicated pair tool, e.g. `mkv` -> mp3.
 *
 * `image-to-searchable-pdf` is the one case that *does* differ meaningfully
 * (OCR, not a plain re-encode), so it's the only `VARIANT_LABELS` entry.
 *
 * `opts.category`, when given, additionally restricts `tools` to that one
 * category's own tools — what a category page's To list uses so a format
 * picked there (including a cross-category one, e.g. mp4 on `/audio`) only
 * ever offers that category's own conversions and actions, never every tool
 * across the site that happens to also accept `from`.
 */
export function targetsFor(
  from: FormatId,
  opts?: { category?: Category },
): {
  conversions: Target[];
  actions: Target[];
} {
  const tools = CATALOG.filter(
    (t) =>
      (t.accepts as readonly FormatId[]).includes(from) &&
      (opts?.category === undefined || t.category === opts.category),
  );

  const actionRows: { target: Target; rank: number; priority: number }[] = [];
  const byFormat = new Map<FormatId, CatalogEntry[]>();
  // Formats a tool reaches only by presetting one of its options
  // (`producesAlso`); used only where no tool produces that format outright.
  const alsoByFormat = new Map<
    FormatId,
    { tool: CatalogEntry; preset: NonNullable<Target["preset"]> }
  >();

  for (const tool of tools) {
    for (const also of tool.producesAlso ?? []) {
      if (also.format !== from && !alsoByFormat.has(also.format)) {
        alsoByFormat.set(also.format, {
          tool,
          preset: also.presetOptions,
        });
      }
    }
    const out = producedFormat(tool, from);
    if (out === from) {
      const label = actionLabelFor(tool);
      actionRows.push({
        target: { kind: "action", label, slug: tool.slug },
        rank: tool.rank ?? Number.POSITIVE_INFINITY,
        priority: actionPriorityIndex(label),
      });
      continue;
    }
    const group = byFormat.get(out);
    if (group) group.push(tool);
    else byFormat.set(out, [tool]);
  }

  const conversions: Target[] = [];
  const formatsInOrder = (Object.keys(FORMATS) as FormatId[]).filter(
    (f) => byFormat.has(f) || alsoByFormat.has(f),
  );
  for (const format of formatsInOrder) {
    const group = byFormat.get(format);
    if (!group) {
      const also = alsoByFormat.get(format);
      if (also) {
        conversions.push({
          kind: "format",
          label: formatLabelFor(format),
          slug: also.tool.slug,
          format,
          preset: also.preset,
        });
      }
      continue;
    }
    const best = pickDefault(group, from, format);
    conversions.push({
      kind: "format",
      label: formatLabelFor(format),
      slug: best.slug,
      format,
    });
    for (const tool of group) {
      if (tool.slug === best.slug) continue;
      const variant = VARIANT_LABELS[tool.slug];
      if (variant === undefined) continue;
      conversions.push({
        kind: "format",
        label: variant,
        slug: tool.slug,
        format,
        variant,
      });
    }
  }

  // Ranked actions (the Popular chips' own tools, e.g. Compress) sort first
  // by that rank; everything else falls back to a fixed, generic priority
  // list of the most-reached-for verbs, then alphabetically — see
  // `ACTION_PRIORITY`'s doc comment.
  actionRows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.target.label.localeCompare(b.target.label);
  });
  const actions = actionRows.map((row) => row.target);

  return { conversions, actions };
}

/** Case-insensitive substring match over a format's label, extensions and
 * aliases — an empty query matches everything. */
export function matchFormat(query: string, format: FormatId): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const spec: FormatSpec = FORMATS[format];
  if (spec.label.toLowerCase().includes(q)) return true;
  if (
    (spec.ext as readonly string[]).some((e) => e.toLowerCase().includes(q))
  ) {
    return true;
  }
  return (spec.aliases ?? []).some((a) => a.toLowerCase().includes(q));
}

/** Case-insensitive substring match over a target's label and (if present)
 * its variant text — an empty query matches everything. */
export function matchTarget(query: string, target: Target): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (target.label.toLowerCase().includes(q)) return true;
  return target.variant?.toLowerCase().includes(q) ?? false;
}

/**
 * The Popular chips (ADR-0015): every tool with a `rank`, ascending, as a
 * `Target` plus the input format it's reachable from — `rank` is set on the
 * tool that should win its `(from, to)` pair's default anyway (see
 * `pickDefault`), so this never points at a slug `targetsFor` wouldn't also
 * resolve to for the same `from`.
 */
export function popular(): PopularEntry[] {
  return CATALOG.filter(
    (t): t is CatalogEntry & { rank: number } => t.rank !== undefined,
  )
    .sort((a, b) => a.rank - b.rank)
    .map((t) => {
      const from = t.accepts[0] as FormatId;
      const out = producedFormat(t, from);
      if (out === from) {
        return {
          kind: "action" as const,
          label: actionLabelFor(t),
          slug: t.slug,
          from,
          rank: t.rank,
          title: t.title,
        };
      }
      return {
        kind: "format" as const,
        label: formatLabelFor(out),
        slug: t.slug,
        format: out,
        from,
        rank: t.rank,
        title: t.title,
      };
    });
}

/** How many tools a category's Popular row shows at most. */
const CATEGORY_POPULAR_LIMIT = 6;

/**
 * A category page's Popular row: that category's tools that set a
 * `categoryRank`, ascending, capped at six. Matches on the tool's own
 * category (not the category of its input format, which is what the
 * site-wide `popular()` chips filter by), so "Extract Audio" sits under
 * Audio even though it takes video in.
 */
export function popularInCategory(category: Category): CatalogEntry[] {
  return CATALOG.filter(
    (t) => t.category === category && t.categoryRank !== undefined,
  )
    .sort((a, b) => (a.categoryRank ?? 0) - (b.categoryRank ?? 0))
    .slice(0, CATEGORY_POPULAR_LIMIT);
}

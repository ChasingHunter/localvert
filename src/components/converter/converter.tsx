"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORY_TINT_BG } from "@/components/category-tint";
import { Combobox, type ComboboxGroup } from "@/components/combobox";
import type { AcceptedFile, RejectedFile } from "@/components/dropzone-logic";
import { PrivacyNote } from "@/components/privacy-note";
import {
  formatsSummaryText,
  inputFormats,
  inputFormatsForCategory,
  matchFormat,
  matchTarget,
  nativeInputFormats,
  popular,
  popularInCategory,
  targetsFor,
} from "@/lib/converter/catalog";
import { setPendingFiles } from "@/lib/converter/handoff";
import { CATEGORY_META, type Category } from "@/lib/registry/categories";
import { FORMATS, type FormatId } from "@/lib/registry/formats";
import {
  type CategoryMismatch,
  type DetectedGroup,
  describeCategoryMismatch,
  describeDetection,
  describeMixed,
  describeUndetected,
  groupByFormat,
  popularChipLabel,
} from "./converter-logic";

/**
 * ADR-0015: the universal "From -> To" converter island. Holds the only
 * state the ADR cares about — `{ from, target, files }` — and both entry
 * flows (the pickers, and dropping files) fill it; neither is a separate
 * mode. Never imports `TOOLS`/any engine — only the generated catalog
 * (`src/lib/converter/catalog.ts`) and plain registry data, so it stays
 * inside the 15 KB gz budget the ADR sets for the home page.
 */

const TO_HINT_ID = "converter-to-hint";
const ALL_FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

/**
 * Code-split, same reasoning `ToolRunner` applies to `OptionsForm`/
 * `CropEditor`: the drop zone's own markup and its sniffing pipeline
 * (`classifyFiles` -> `sniffFile`/`refineFormat`) aren't needed for the
 * pickers' first paint, so they load lazily instead of costing every home
 * page visit its first-load JS budget (ADR-0015's 15 KB gz cap). `ssr:
 * false` is fine here — the pickers and Popular links (the ADR's "work
 * before hydration" pieces) still render normally; only this one region
 * shows its `loading` fallback until the chunk arrives.
 */
const Dropzone = dynamic(
  () => import("@/components/dropzone").then((mod) => mod.Dropzone),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-ink-muted">
        Loading drop zone…
      </div>
    ),
  },
);

/** Extensions shown as a combobox option's hint, e.g. ".jpg, .jpeg". */
function extHint(format: FormatId): string {
  return FORMATS[format].ext.map((e) => `.${e}`).join(", ");
}

/**
 * Replays the `.format-swap` CSS animation (globals.css) when `value`
 * changes, by removing and re-adding the class across a forced reflow —
 * never by remounting the element. An earlier version keyed the wrapping
 * span by the picker's value instead, which unmounted and recreated the
 * `Combobox` itself (input included) on every commit; that silently broke
 * keyboard focus after Enter (the freshly created input was never the one
 * that had focus), caught by e2e/converter.spec.ts's keyboard-only test.
 */
function useSwapAnimation<T>(value: T) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(value);
  useEffect(() => {
    if (prevRef.current === value) return;
    prevRef.current = value;
    const el = ref.current;
    if (!el) return;
    el.classList.remove("format-swap");
    void el.offsetWidth; // force a reflow so re-adding the class restarts the animation
    el.classList.add("format-swap");
  }, [value]);
  return ref;
}

/** One Popular chip: where it links, its text, and whose colour it wears. */
interface PopularChip {
  slug: string;
  label: string;
  tint: Category;
}

interface ConverterProps {
  /** Pre-filters the From picker to one category's formats — used on a
   * category page (ADR-0015 "Where it lives"). Detection and the To list
   * are never restricted by it: a dropped file outside the category still
   * gets detected and converted normally. */
  category?: Category;
  /**
   * "hero" lays the pickers out as the home page's sentence ("Convert my
   * [From] into [To]", ADR-0016) instead of the default side-by-side panel
   * every other page uses. Everything else about the island — state,
   * keyboard contract, live region — is identical in both variants.
   */
  variant?: "panel" | "hero";
  /**
   * Only meaningful on the "hero" variant. "compact" is one type-scale step
   * down from the home page's own hero (ADR-0016's design review: a category
   * page already has its own `<h1>`, so its sentence converter doesn't need
   * to be quite as large) — used on `/[category]`. Everything about the
   * hero's layout and behaviour stays the same, only its type size changes.
   */
  size?: "default" | "compact";
}

export function Converter({
  category,
  variant = "panel",
  size = "default",
}: ConverterProps) {
  const router = useRouter();

  const [fromQuery, setFromQuery] = useState("");
  const [fromId, setFromId] = useState<FormatId | null>(null);
  const [toQuery, setToQuery] = useState("");
  const [toId, setToId] = useState<string | null>(null);

  // Files staged from a drop, tied to whichever format group is currently
  // selected as `fromId` — cleared whenever From changes some other way, so
  // a target chosen afterwards never hands off files from a stale format.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [mixedGroups, setMixedGroups] = useState<DetectedGroup[] | null>(null);
  const [undetected, setUndetected] = useState<RejectedFile[]>([]);
  const [categoryMismatch, setCategoryMismatch] =
    useState<CategoryMismatch | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const toResultsRef = useRef<number | null>(null);

  // Incremented whenever detection resolves a single format, to move DOM
  // focus to the To input once it's enabled (ADR-0015's focus-management
  // contract) — an effect rather than a synchronous call so it runs after
  // the render that flips `disabled` off.
  const [focusToRequest, setFocusToRequest] = useState(0);
  useEffect(() => {
    if (focusToRequest === 0) return;
    document.getElementById("converter-to")?.focus();
  }, [focusToRequest]);

  // On a category page, every picker/drop-area/detection concern below is
  // scoped to that one category's own tools (the bug this component exists
  // to fix) — `inputFormatsForCategory` already includes the format's own
  // cross-category label (e.g. "Video (extract the audio)" on `/audio`), so
  // `scopedInputGroups` needs no separate category filter the way the old
  // `inputFormats().filter(...)` line did (that filter is what dropped every
  // cross-category format, since a format's *own* category never matches the
  // page's).
  const scopedInputGroups = category
    ? inputFormatsForCategory(category)
    : inputFormats().map((g) => ({
        ...g,
        label: CATEGORY_META[g.category].label,
      }));
  const scopedAcceptedFormats: FormatId[] = category
    ? scopedInputGroups.flatMap((g) => g.formats)
    : ALL_FORMAT_IDS;

  const fromGroups: ComboboxGroup[] = scopedInputGroups.map((g) => ({
    id: g.category,
    label: g.label,
    options: g.formats
      .filter((f) => matchFormat(fromQuery, f))
      .map((f) => ({ id: f, label: FORMATS[f].label, hint: extHint(f) })),
  }));

  const targets = fromId
    ? targetsFor(fromId, { category })
    : { conversions: [], actions: [] };
  const toGroups: ComboboxGroup[] = fromId
    ? [
        {
          id: "conversions",
          label: "Convert to",
          options: targets.conversions
            .filter((t) => matchTarget(toQuery, t))
            .map((t) => ({ id: t.slug, label: t.label, hint: t.variant })),
        },
        {
          id: "actions",
          label: "Actions",
          options: targets.actions
            .filter((t) => matchTarget(toQuery, t))
            .map((t) => ({ id: t.slug, label: t.label })),
        },
      ]
    : [];

  const handleFromChange = useCallback((id: string) => {
    setFromId(id as FormatId);
    setToId(null);
    setToQuery("");
    setStagedFiles([]);
    setMixedGroups(null);
  }, []);

  const selectGroup = useCallback(
    (group: DetectedGroup) => {
      setMixedGroups(null);
      setUndetected([]);
      setCategoryMismatch(null);
      setFromId(group.format);
      setFromQuery(FORMATS[group.format].label);
      setToId(null);
      setToQuery("");
      setStagedFiles(group.files.map((f) => f.file));
      const { conversions, actions } = targetsFor(group.format, { category });
      setLiveMessage(
        describeDetection(group, conversions.length + actions.length),
      );
      setFocusToRequest((n) => n + 1);
    },
    [category],
  );

  const handleDroppedFiles = useCallback(
    (accepted: AcceptedFile[], rejected: RejectedFile[]) => {
      setUndetected([]);
      setCategoryMismatch(null);
      if (accepted.length === 0) {
        if (rejected.length > 0) {
          // On a category page, a recognized-but-wrong-category file (e.g. a
          // PDF dropped on /audio) gets its own message pointing at where it
          // actually belongs, instead of the generic "unrecognized format"
          // treatment — see `describeCategoryMismatch`'s doc comment.
          const mismatch = category
            ? describeCategoryMismatch(rejected, category)
            : null;
          if (mismatch) {
            setCategoryMismatch(mismatch);
            setLiveMessage(`${mismatch.message} ${mismatch.linkText}`);
          } else {
            setUndetected(rejected);
            setLiveMessage(describeUndetected(rejected));
          }
        }
        return;
      }
      const groups = groupByFormat(accepted);
      if (groups.length === 1) {
        selectGroup(groups[0] as DetectedGroup);
      } else {
        setMixedGroups(groups);
        setLiveMessage(describeMixed(groups));
      }
    },
    [selectGroup, category],
  );

  const handleToChange = useCallback(
    (slug: string) => {
      setToId(slug);
      if (stagedFiles.length > 0) {
        setPendingFiles(slug, stagedFiles);
        router.push(`/tools/${slug}`);
      }
    },
    [stagedFiles, router],
  );

  const handleGo = useCallback(() => {
    if (!fromId || !toId) return;
    if (stagedFiles.length > 0) setPendingFiles(toId, stagedFiles);
    router.push(`/tools/${toId}`);
  }, [fromId, toId, stagedFiles, router]);

  const handleToResultsCount = useCallback(
    (count: number) => {
      if (toQuery.trim() === "") {
        toResultsRef.current = count;
        return;
      }
      if (toResultsRef.current === count) return;
      toResultsRef.current = count;
      setLiveMessage(`${count} result${count === 1 ? "" : "s"}`);
    },
    [toQuery],
  );

  const canGo = fromId !== null && toId !== null;
  // Home: the site-wide top eight. A category page: that category's own
  // most useful tools (`categoryRank`), so /audio and /data get a row too
  // instead of only the categories that own a site-wide top-eight tool.
  const popularChips: PopularChip[] = category
    ? popularInCategory(category).map((t) => ({
        slug: t.slug,
        label: t.title,
        tint: t.category,
      }))
    : popular().map((p) => ({
        slug: p.slug,
        label: popularChipLabel(p),
        tint: FORMATS[p.from].category,
      }));

  const isHero = variant === "hero";
  const fromSwapRef = useSwapAnimation(fromId);
  const toSwapRef = useSwapAnimation(toId);

  // The hero pills' fill colour once a value is picked (ADR-0016's design
  // review: "use the selected format's category tint once chosen"). The To
  // pill's value is a tool slug, not a format — a conversion target carries
  // its own output `format`; a same-format action doesn't, so it falls back
  // to From's category, which is the format it stays in.
  const fromTint = fromId
    ? CATEGORY_TINT_BG[FORMATS[fromId].category]
    : undefined;
  const selectedToTarget = toId
    ? [...targets.conversions, ...targets.actions].find((t) => t.slug === toId)
    : undefined;
  const toTintFormat = selectedToTarget?.format ?? fromId ?? undefined;
  const toTint = toTintFormat
    ? CATEGORY_TINT_BG[FORMATS[toTintFormat].category]
    : undefined;

  return (
    <div id="converter" className="flex flex-col gap-6">
      {!isHero && (
        <Dropzone
          accepts={scopedAcceptedFormats}
          multiple
          onFiles={handleDroppedFiles}
        />
      )}

      {isHero ? (
        <>
          <div
            className={`flex flex-col gap-3 font-display font-semibold leading-[1.1] text-ink sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3 sm:gap-y-2 ${
              size === "compact"
                ? "text-[clamp(1.75rem,4vw,2.4375rem)]"
                : "text-[clamp(2.25rem,5vw,3.5rem)]"
            }`}
          >
            <span>Convert my</span>
            <span
              ref={fromSwapRef}
              className="format-swap block w-full sm:inline-block sm:w-auto"
            >
              <Combobox
                id="converter-from"
                label="Convert from"
                hideLabel
                pill
                tintClassName={fromTint}
                placeholder="this"
                groups={fromGroups}
                query={fromQuery}
                onQueryChange={setFromQuery}
                value={fromId}
                onChange={handleFromChange}
                emptyText="No formats match."
              />
            </span>
            <span>into</span>
            <div className="flex w-full flex-col gap-1.5 sm:w-auto">
              <span
                ref={toSwapRef}
                className="format-swap block w-full sm:inline-block sm:w-auto"
              >
                <Combobox
                  id="converter-to"
                  label="Convert to"
                  hideLabel
                  pill
                  tintClassName={toTint}
                  placeholder="that"
                  groups={toGroups}
                  query={toQuery}
                  onQueryChange={setToQuery}
                  value={toId}
                  onChange={handleToChange}
                  emptyText="No options match."
                  disabled={!fromId}
                  describedBy={!fromId ? TO_HINT_ID : undefined}
                  onResultsCountChange={handleToResultsCount}
                />
              </span>
              {!fromId && (
                <p id={TO_HINT_ID} className="text-xs font-sans text-ink-muted">
                  Choose what you're converting from first
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleGo}
              disabled={!canGo}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-6 py-2 font-sans text-base font-medium text-canvas shadow-sm outline-none transition-colors hover:bg-accent/90 hover:shadow focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none motion-reduce:transition-none sm:w-auto"
            >
              Convert
            </button>
          </div>

          <PrivacyNote size={size === "compact" ? "sm" : "base"} />
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Combobox
            id="converter-from"
            label="Convert from"
            placeholder="e.g. PDF, jpeg, word…"
            groups={fromGroups}
            query={fromQuery}
            onQueryChange={setFromQuery}
            value={fromId}
            onChange={handleFromChange}
            emptyText="No formats match."
          />
          <div className="flex flex-col gap-1.5">
            <Combobox
              id="converter-to"
              label="Convert to"
              placeholder="e.g. Word, compress…"
              groups={toGroups}
              query={toQuery}
              onQueryChange={setToQuery}
              value={toId}
              onChange={handleToChange}
              emptyText="No options match."
              disabled={!fromId}
              describedBy={!fromId ? TO_HINT_ID : undefined}
              onResultsCountChange={handleToResultsCount}
            />
            {!fromId && (
              <p id={TO_HINT_ID} className="text-xs text-ink-muted">
                Choose what you're converting from first
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleGo}
            disabled={!canGo}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none sm:min-w-24"
          >
            Convert
          </button>
        </div>
      )}

      {isHero && (
        <Dropzone
          accepts={scopedAcceptedFormats}
          multiple
          onFiles={handleDroppedFiles}
          promptText="Or drop a file here and we'll work out what it is."
          showChooseFilesBadge
          hideFooterNote
          compactFormatsSummary
          summaryText={
            category
              ? formatsSummaryText(nativeInputFormats(category))
              : undefined
          }
        />
      )}

      {mixedGroups && (
        // biome-ignore lint/a11y/useSemanticElements: this is an APG-style option group of buttons, not a form <fieldset>.
        <div
          role="group"
          aria-label="Choose a format to continue with"
          className="flex flex-wrap gap-2"
        >
          {mixedGroups.map((group) => (
            <button
              key={group.format}
              type="button"
              onClick={() => selectGroup(group)}
              className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink outline-none hover:bg-canvas focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {group.files.length} {FORMATS[group.format].label}
            </button>
          ))}
        </div>
      )}

      {categoryMismatch && (
        <p className="text-xs text-ink-muted">
          {categoryMismatch.message}{" "}
          <Link
            href={categoryMismatch.linkHref}
            className="font-medium text-ink underline outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {categoryMismatch.linkText}
          </Link>
        </p>
      )}

      {undetected.length > 0 && (
        <ul className="flex flex-col gap-1">
          {undetected.map((r) => (
            <li
              key={`${r.file.name}-${r.file.size}`}
              className="text-xs text-danger"
            >
              <span className="font-medium">{r.file.name}</span>: unrecognized
              format.
            </li>
          ))}
        </ul>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {popularChips.length > 0 && (
        // A named landmark, not a plain div: since the popular chip and its
        // matching category link-list entry now share the same tool title
        // (`popularChipLabel`, above), this is also what tells the two
        // "PDF to Word" links apart for anything scoping by role/name
        // (e2e/converter.spec.ts's Popular chip test).
        <nav aria-label="Popular conversions" className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">Popular</span>
          <div className="flex flex-wrap gap-2">
            {popularChips.map((entry) => (
              <Link
                key={entry.slug}
                href={`/tools/${entry.slug}`}
                className={`flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium text-ink outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none ${CATEGORY_TINT_BG[entry.tint]}`}
              >
                {entry.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

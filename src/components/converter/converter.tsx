"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORY_TINT_BG } from "@/components/category-tint";
import { Combobox, type ComboboxGroup } from "@/components/combobox";
import type { AcceptedFile, RejectedFile } from "@/components/dropzone-logic";
import {
  inputFormats,
  matchFormat,
  matchTarget,
  popular,
  targetsFor,
} from "@/lib/converter/catalog";
import { setPendingFiles } from "@/lib/converter/handoff";
import { CATEGORY_META, type Category } from "@/lib/registry/categories";
import { FORMATS, type FormatId } from "@/lib/registry/formats";
import {
  type DetectedGroup,
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
}

export function Converter({ category, variant = "panel" }: ConverterProps) {
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

  const allInputGroups = inputFormats();
  const scopedInputGroups = category
    ? allInputGroups.filter((g) => g.category === category)
    : allInputGroups;

  const fromGroups: ComboboxGroup[] = scopedInputGroups.map((g) => ({
    id: g.category,
    label: CATEGORY_META[g.category].label,
    options: g.formats
      .filter((f) => matchFormat(fromQuery, f))
      .map((f) => ({ id: f, label: FORMATS[f].label, hint: extHint(f) })),
  }));

  const targets = fromId
    ? targetsFor(fromId)
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

  const selectGroup = useCallback((group: DetectedGroup) => {
    setMixedGroups(null);
    setUndetected([]);
    setFromId(group.format);
    setFromQuery(FORMATS[group.format].label);
    setToId(null);
    setToQuery("");
    setStagedFiles(group.files.map((f) => f.file));
    const { conversions, actions } = targetsFor(group.format);
    setLiveMessage(
      describeDetection(group, conversions.length + actions.length),
    );
    setFocusToRequest((n) => n + 1);
  }, []);

  const handleDroppedFiles = useCallback(
    (accepted: AcceptedFile[], rejected: RejectedFile[]) => {
      setUndetected([]);
      if (accepted.length === 0) {
        if (rejected.length > 0) {
          setUndetected(rejected);
          setLiveMessage(describeUndetected(rejected));
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
    [selectGroup],
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
  const popularChips = popular().filter(
    (p) => !category || FORMATS[p.from].category === category,
  );

  const isHero = variant === "hero";
  const fromSwapRef = useSwapAnimation(fromId);
  const toSwapRef = useSwapAnimation(toId);

  return (
    <div id="converter" className="flex flex-col gap-6">
      {!isHero && (
        <Dropzone
          accepts={ALL_FORMAT_IDS}
          multiple
          onFiles={handleDroppedFiles}
        />
      )}

      {isHero ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 font-display text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.1] text-ink">
          <span>Convert my</span>
          <span ref={fromSwapRef} className="format-swap">
            <Combobox
              id="converter-from"
              label="Convert from"
              hideLabel
              pill
              placeholder="a format…"
              groups={fromGroups}
              query={fromQuery}
              onQueryChange={setFromQuery}
              value={fromId}
              onChange={handleFromChange}
              emptyText="No formats match."
            />
          </span>
          <span>into</span>
          <div className="flex flex-col gap-1.5">
            <span ref={toSwapRef} className="format-swap">
              <Combobox
                id="converter-to"
                label="Convert to"
                hideLabel
                pill
                placeholder="a format…"
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
              <p id={TO_HINT_ID} className="text-sm font-sans text-ink-muted">
                Choose what you're converting from first
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleGo}
            disabled={!canGo}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2 font-sans text-base font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          >
            Convert
          </button>
        </div>
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
          accepts={ALL_FORMAT_IDS}
          multiple
          onFiles={handleDroppedFiles}
          promptText="Or drop a file here and we'll work out what it is."
          showChooseFilesBadge
          hideFooterNote
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
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">Popular</span>
          <div className="flex flex-wrap gap-2">
            {popularChips.map((entry) => (
              <Link
                key={entry.slug}
                href={`/tools/${entry.slug}`}
                className={`flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium text-ink outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none ${CATEGORY_TINT_BG[FORMATS[entry.from].category]}`}
              >
                {popularChipLabel(entry)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

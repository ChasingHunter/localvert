"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  type ComboboxAction,
  type ComboboxOption,
  type ComboboxState,
  comboboxReducer,
  initialComboboxState,
} from "./combobox-logic";

/**
 * Accessible "editable combobox with listbox popup" (W3C APG), driven by the
 * pure reducer in `combobox-logic.ts`. Filtering is the caller's job —
 * `groups` is already the filtered, current option set for `query`.
 *
 * Minimal example (see ADR-0015 for the full From/To picker):
 *
 * ```tsx
 * const [query, setQuery] = useState("");
 * const [value, setValue] = useState<string | null>(null);
 * <Combobox
 *   id="from-format"
 *   label="From"
 *   placeholder="e.g. PDF, jpeg, word…"
 *   query={query}
 *   onQueryChange={setQuery}
 *   value={value}
 *   onChange={setValue}
 *   emptyText="No formats match."
 *   groups={[
 *     { id: "documents", label: "Documents", options: [{ id: "pdf", label: "PDF" }] },
 *   ]}
 * />
 * ```
 */

export interface ComboboxOptionSpec {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface ComboboxGroup {
  id: string;
  label: string;
  options: ComboboxOptionSpec[];
}

export interface ComboboxProps {
  id: string;
  label: string;
  placeholder?: string;
  groups: ComboboxGroup[];
  query: string;
  onQueryChange: (query: string) => void;
  value: string | null;
  onChange: (id: string) => void;
  emptyText: string;
  describedBy?: string;
  /** ADR-0015: the To picker is disabled until From is set. A disabled
   * input can't gain focus or fire key/change events, so the popup and
   * reducer dispatches never engage — no extra guarding needed here. */
  disabled?: boolean;
  /** Fires whenever the number of visible options changes — the page's own
   * live region (ADR-0015) uses this to announce "N results", so this
   * component never announces a count itself. */
  onResultsCountChange?: (count: number) => void;
  /** Visually hides the `<label>` (still in the DOM, still the input's
   * accessible name) — the home hero (ADR-0016) sets the picker's context
   * from the surrounding sentence instead ("Convert my [From] into [To]"),
   * so repeating "Convert from"/"Convert to" as visible text would be
   * redundant there. Every other caller leaves this off. */
  hideLabel?: boolean;
  /** Pill-shaped input (full radius, auto width) for the home hero's inline
   * sentence layout (ADR-0016's radius hierarchy: pickers are pills).
   * Every other caller keeps the default rectangular, full-width field. */
  pill?: boolean;
  /** Background class for a filled `pill` (its category tint, from
   * `CATEGORY_TINT_BG`) — the caller resolves this from the selected
   * format since this component doesn't know about formats or categories.
   * Ignored when `pill` is false or no value is selected. Falls back to
   * `bg-accent-soft` when a pill has a value but no tint was given. */
  tintClassName?: string;
}

function flattenOptions(groups: ComboboxGroup[]): ComboboxOption[] {
  return groups.flatMap((g) =>
    g.options.map((o) => ({ id: o.id, groupId: g.id, disabled: o.disabled })),
  );
}

function findOptionSpec(
  groups: ComboboxGroup[],
  id: string | null,
): ComboboxOptionSpec | undefined {
  if (id === null) return undefined;
  for (const g of groups) {
    const found = g.options.find((o) => o.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Joins class names, skipping falsy ones. Deliberately not the shared
 * `cn()` (clsx + tailwind-merge): this component sits on the home page's
 * first load, where tailwind-merge alone cost ~8.5 KB gz, and none of its
 * class lists need conflict merging — each conditional picks one side.
 */
function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function optionDomId(comboboxId: string, optionId: string): string {
  return `${comboboxId}-opt-${optionId}`;
}

/**
 * A `pill` wrapper's border/background, by state — reads as a "blank in the
 * sentence" (ADR-0016's design review): dashed and empty until a value is
 * picked, then filled with its category tint (or `accent-soft` as a
 * fallback), and visibly muted while disabled (the To pill before From is
 * set) without losing its place in the sentence.
 */
function pillWrapperClasses(
  hasValue: boolean,
  disabled: boolean,
  tintClassName?: string,
): string {
  if (disabled) {
    return "border-2 border-dashed border-border bg-transparent opacity-50";
  }
  if (hasValue) {
    return classes(
      tintClassName ?? "bg-accent-soft",
      "border border-transparent",
    );
  }
  return "border-2 border-dashed border-ink-muted/40 bg-transparent hover:border-ink-muted/70";
}

export function Combobox({
  id,
  label,
  placeholder,
  groups,
  query,
  onQueryChange,
  value,
  onChange,
  emptyText,
  describedBy,
  disabled = false,
  onResultsCountChange,
  hideLabel = false,
  pill = false,
  tintClassName,
}: ComboboxProps) {
  const listId = `${id}-listbox`;
  const reactId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Set on an option's mousedown and cleared on mouseup: without it, the
  // input's blur fires before the option's click, closing the popup and
  // losing the click.
  const suppressBlurRef = useRef(false);

  const options = flattenOptions(groups);
  const ctx = {
    options,
    labelOf: (optId: string) => findOptionSpec(groups, optId)?.label ?? "",
  };

  const [state, setState] = useState<ComboboxState>(() => ({
    ...initialComboboxState(value),
    query,
  }));

  function dispatch(action: ComboboxAction) {
    setState((prev) => {
      const next = comboboxReducer(prev, action, ctx);
      if (next.query !== prev.query) onQueryChange(next.query);
      if (next.selectedId !== prev.selectedId && next.selectedId !== null) {
        onChange(next.selectedId);
      }
      return next;
    });
  }

  // Mirror controlled `value`/`query` changes that originate outside this
  // component (e.g. the parent resetting the picker) into local state,
  // without fighting the reducer's own updates to the same fields.
  const prevValueRef = useRef(value);
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setState((s) =>
        s.selectedId === value ? s : { ...s, selectedId: value },
      );
    }
  }, [value]);
  useEffect(() => {
    if (prevQueryRef.current !== query) {
      prevQueryRef.current = query;
      setState((s) => (s.query === query ? s : { ...s, query }));
    }
  }, [query]);

  // Re-run `optionsChanged` whenever the caller's filtered list changes
  // shape (new query, or the catalog itself changing) — this is what keeps
  // "active" pointing at a still-visible, still-enabled option instead of a
  // stale pre-filter one.
  const optionIdsKey = options
    .map((o) => `${o.id}:${o.disabled ? 1 : 0}`)
    .join(",");
  // `options`/`ctx` are rebuilt every render from `groups`; `optionIdsKey` is
  // the real dependency here — it only changes when the visible set does, so
  // that's what this effect keys off rather than the two derived objects.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on optionIdsKey by design — see comment above.
  useEffect(() => {
    setState((prev) =>
      comboboxReducer(prev, { type: "optionsChanged", options }, ctx),
    );
    onResultsCountChange?.(options.length);
  }, [optionIdsKey]);

  // `dispatch` closes over `ctx`, which is rebuilt every render — listing it
  // would re-attach the listener on every keystroke for no benefit, since
  // the closure below already reads the latest `dispatch` via the effect
  // re-running whenever `state.open` itself changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispatch is stable enough per open/close cycle — see comment above.
  useEffect(() => {
    if (!state.open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        dispatch({ type: "blur" });
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [state.open]);

  useEffect(() => {
    if (!state.open || state.activeId === null) return;
    document
      .getElementById(optionDomId(id, state.activeId))
      ?.scrollIntoView({ block: "nearest" });
  }, [state.open, state.activeId, id]);

  const activeDescendant =
    state.open && state.activeId !== null
      ? optionDomId(id, state.activeId)
      : undefined;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={classes(
          "text-sm font-medium text-ink",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>
      {pill ? (
        <div
          className={classes(
            // `has-[:focus-visible]` puts the focus ring on the pill's own
            // outline (chevron included) instead of just the input inside
            // it — DOM focus stays on the input (APG combobox contract),
            // this only follows it visually.
            "relative flex w-full items-center rounded-full transition-colors has-focus-visible:ring-2 has-focus-visible:ring-accent has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-canvas sm:inline-flex sm:w-auto",
            pillWrapperClasses(value !== null, disabled, tintClassName),
          )}
        >
          {/* `.pill-sizer` (globals.css): a CSS-only auto-growing input —
           * `data-value` drives an invisible `::after` mirror that sets the
           * grid column's width, so the input hugs its content (min 4ch)
           * instead of sitting at a fixed size. `flex-1` fills the pill at
           * mobile's full-width stacked layout; `sm:flex-none` lets it
           * shrink back to that hugged width once the sentence goes
           * inline. */}
          <div
            className="pill-sizer min-w-0 flex-1 sm:flex-none"
            data-value={state.query || placeholder || ""}
          >
            <input
              ref={inputRef}
              id={id}
              role="combobox"
              type="text"
              // The browser's own default text-input width (~20 characters)
              // otherwise wins the `.pill-sizer` grid column's auto-sizing
              // over the small `::after` mirror, since track sizing takes
              // the max of every item's intrinsic content size. `size={1}`
              // is the standard fix — it only lowers that UA sizing hint,
              // it doesn't cap how many characters can actually be typed.
              size={1}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={state.open}
              aria-controls={listId}
              aria-activedescendant={activeDescendant}
              aria-describedby={describedBy}
              placeholder={placeholder}
              value={state.query}
              disabled={disabled}
              onChange={(e) =>
                dispatch({ type: "input", query: e.target.value })
              }
              onBlur={() => {
                if (suppressBlurRef.current) return;
                dispatch({ type: "blur" });
              }}
              onKeyDown={(e) => {
                switch (e.key) {
                  case "ArrowDown":
                    e.preventDefault();
                    dispatch({ type: "arrowDown" });
                    break;
                  case "ArrowUp":
                    e.preventDefault();
                    dispatch({ type: "arrowUp" });
                    break;
                  case "Home":
                    if (state.open) {
                      e.preventDefault();
                      dispatch({ type: "home" });
                    }
                    break;
                  case "End":
                    if (state.open) {
                      e.preventDefault();
                      dispatch({ type: "end" });
                    }
                    break;
                  case "Enter":
                    if (state.open) e.preventDefault();
                    dispatch({ type: "enter" });
                    break;
                  case "Escape":
                    if (state.open || state.query) e.preventDefault();
                    dispatch({ type: "escape" });
                    break;
                  case "Tab":
                    // Never preventDefault: Tab must still move focus on.
                    dispatch({ type: "tab" });
                    break;
                  default:
                    break;
                }
              }}
              className="rounded-full bg-transparent px-3 py-1 text-ink outline-none [font:inherit] placeholder:text-ink-muted/70 disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label="Show options"
            onMouseDown={(e) => {
              // Keep DOM focus on the input; toggling must not steal it.
              e.preventDefault();
            }}
            onClick={() => {
              inputRef.current?.focus();
              dispatch(state.open ? { type: "blur" } : { type: "arrowDown" });
            }}
            className="flex size-9 shrink-0 items-center justify-center text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={classes(
                "size-5 transition-transform motion-reduce:transition-none",
                state.open && "rotate-180",
              )}
            />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            type="text"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={state.open}
            aria-controls={listId}
            aria-activedescendant={activeDescendant}
            aria-describedby={describedBy}
            placeholder={placeholder}
            value={state.query}
            disabled={disabled}
            onChange={(e) => dispatch({ type: "input", query: e.target.value })}
            onBlur={() => {
              if (suppressBlurRef.current) return;
              dispatch({ type: "blur" });
            }}
            onKeyDown={(e) => {
              switch (e.key) {
                case "ArrowDown":
                  e.preventDefault();
                  dispatch({ type: "arrowDown" });
                  break;
                case "ArrowUp":
                  e.preventDefault();
                  dispatch({ type: "arrowUp" });
                  break;
                case "Home":
                  if (state.open) {
                    e.preventDefault();
                    dispatch({ type: "home" });
                  }
                  break;
                case "End":
                  if (state.open) {
                    e.preventDefault();
                    dispatch({ type: "end" });
                  }
                  break;
                case "Enter":
                  if (state.open) e.preventDefault();
                  dispatch({ type: "enter" });
                  break;
                case "Escape":
                  if (state.open || state.query) e.preventDefault();
                  dispatch({ type: "escape" });
                  break;
                case "Tab":
                  // Never preventDefault: Tab must still move focus on.
                  dispatch({ type: "tab" });
                  break;
                default:
                  break;
              }
            }}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-9 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label="Show options"
            onMouseDown={(e) => {
              // Keep DOM focus on the input; toggling must not steal it.
              e.preventDefault();
            }}
            onClick={() => {
              inputRef.current?.focus();
              dispatch(state.open ? { type: "blur" } : { type: "arrowDown" });
            }}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={classes(
                "size-4 transition-transform motion-reduce:transition-none",
                state.open && "rotate-180",
              )}
            />
          </button>
        </div>
      )}
      {state.open &&
        (options.length === 0 ? (
          <div
            role="status"
            className={classes(
              "absolute top-full z-10 mt-1 w-full rounded-lg border border-border bg-surface p-3 font-sans font-normal text-sm text-ink-muted shadow-md",
              pill && "min-w-64",
            )}
          >
            {emptyText}
          </div>
        ) : (
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className={classes(
              // `font-normal` undoes the hero sentence's inherited
              // `font-semibold` (font-weight, unlike font-family, inherits
              // through `font-sans` too) — group labels/options set their
              // own weight where they want one heavier than this.
              "absolute top-full z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface py-1 font-sans font-normal shadow-md",
              pill && "min-w-64",
            )}
          >
            {groups.map((group) => {
              if (group.options.length === 0) return null;
              const headingId = `${reactId}-${group.id}-heading`;
              return (
                <div key={group.id}>
                  <div
                    role="presentation"
                    id={headingId}
                    className="px-3 py-1 text-xs font-medium text-ink-muted"
                  >
                    {group.label}
                  </div>
                  {/* biome-ignore lint/a11y/useSemanticElements: role="group" here is an APG listbox option-group, not a form <fieldset>. */}
                  <div role="group" aria-labelledby={headingId}>
                    {group.options.map((option) => {
                      const isActive = state.activeId === option.id;
                      const isSelected = state.selectedId === option.id;
                      return (
                        // Focus deliberately never lands here: the APG
                        // "editable combobox" pattern keeps DOM focus on the
                        // input at all times and tracks the active option via
                        // `aria-activedescendant` instead of a roving
                        // tabindex, so this option is a non-focusable
                        // role="option" by design, not an oversight.
                        // biome-ignore lint/a11y/useFocusableInteractive: activedescendant pattern — see comment above.
                        // biome-ignore lint/a11y/useKeyWithClickEvents: the input's onKeyDown drives selection; this handles pointer commit only.
                        <div
                          key={option.id}
                          id={optionDomId(id, option.id)}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={option.disabled || undefined}
                          onMouseDown={(e) => {
                            // Prevent the input from blurring before click
                            // fires, which would close the popup first.
                            e.preventDefault();
                            suppressBlurRef.current = true;
                          }}
                          onMouseUp={() => {
                            suppressBlurRef.current = false;
                          }}
                          onMouseEnter={() => {
                            if (option.disabled) return;
                            setState((s) => ({ ...s, activeId: option.id }));
                          }}
                          onClick={() => {
                            if (option.disabled) return;
                            dispatch({ type: "optionClick", id: option.id });
                            inputRef.current?.focus();
                          }}
                          className={classes(
                            "flex min-h-11 flex-col justify-center gap-0.5 px-3 py-1.5 text-sm text-ink",
                            isActive && "bg-canvas",
                            option.disabled
                              ? "cursor-not-allowed opacity-50"
                              : "cursor-pointer",
                          )}
                        >
                          <span>{option.label}</span>
                          {option.hint && (
                            <span className="text-xs text-ink-muted">
                              {option.hint}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

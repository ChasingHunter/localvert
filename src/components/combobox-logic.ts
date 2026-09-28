/**
 * Pure, framework-free state machine for the "From"/"To" pickers in
 * ADR-0015 (the universal converter). `combobox.tsx` renders this reducer's
 * state; nothing here touches the DOM, so it's unit-testable without React.
 *
 * The caller owns filtering: `optionsChanged` is handed the already-filtered,
 * flat list of visible `{ id, groupId?, disabled? }` rows (groups flattened
 * in display order), and the reducer only ever tracks *which id* is active —
 * never the option data itself.
 *
 * ## Transition table (APG "editable combobox with list autocomplete")
 *
 * | State \ action        | closed, no query                          | closed, query set                | open                                                         |
 * | ---------------------- | ------------------------------------------ | --------------------------------- | ------------------------------------------------------------ |
 * | `input`                 | open, query set, active = first match      | open, query set, active = first match | active = first match                                     |
 * | `arrowDown`             | open, active = selected (if visible) else first enabled | same                | active = next enabled option, no wrap                        |
 * | `arrowUp`               | open, active = last enabled                | same                              | active = previous enabled option, no wrap                     |
 * | `home`                  | n/a (closed)                               | n/a                                | active = first enabled                                        |
 * | `end`                   | n/a                                         | n/a                                | active = last enabled                                         |
 * | `enter`                 | no-op                                       | no-op                             | commits active: selected = active, closes, query = label(active) |
 * | `escape`                | no-op                                       | clears query                      | closes (query unchanged)                                      |
 * | `tab`                   | no-op                                       | no-op                             | commits active like `enter`, closes (never traps focus)       |
 * | `blur`                  | no-op                                       | no-op                             | closes, does not commit                                       |
 * | `optionClick(id)`       | n/a                                         | n/a                                | commits `id` like `enter`                                     |
 * | `optionsChanged(ids)`   | active recomputed if stale                 | same                              | active kept if still present, else first enabled              |
 *
 * Design choices (deviations from / clarifications of raw APG, documented
 * per the brief):
 * - **No wraparound.** ArrowDown at the last option, or ArrowUp at the
 *   first, stays put. APG allows either; Localvert's lists are filtered and
 *   can be long, and silent wraparound after typing is easy to miss — we'd
 *   rather the user see they've hit an edge.
 * - **Disabled options are never active.** Move actions skip over them
 *   entirely; they're not reachable by keyboard, matching disabled `<option>`
 *   behaviour in native selects.
 * - **Tab always commits, never traps.** If nothing is active (e.g. every
 *   option disabled) Tab just closes and moves focus on, per APG's "never
 *   trap focus" rule.
 * - **Escape is two-stage**, matching APG: first press closes an open popup
 *   without touching the query; a second press (now closed) clears the query.
 */

export interface ComboboxOption {
  id: string;
  groupId?: string;
  disabled?: boolean;
}

export interface ComboboxState {
  open: boolean;
  query: string;
  activeId: string | null;
  selectedId: string | null;
}

export type ComboboxAction =
  | { type: "input"; query: string }
  | { type: "arrowDown" }
  | { type: "arrowUp" }
  | { type: "home" }
  | { type: "end" }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "tab" }
  | { type: "blur" }
  | { type: "optionClick"; id: string }
  | { type: "optionsChanged"; options: readonly ComboboxOption[] };

/** Reducer context: the current visible option list (owned by the caller,
 * re-supplied via `optionsChanged`) and a way to look up an option's label
 * to fill the query box when a commit happens. */
export interface ComboboxContext {
  options: readonly ComboboxOption[];
  labelOf: (id: string) => string;
}

export function initialComboboxState(
  selectedId: string | null = null,
): ComboboxState {
  return { open: false, query: "", activeId: null, selectedId };
}

function firstEnabled(options: readonly ComboboxOption[]): string | null {
  return options.find((o) => !o.disabled)?.id ?? null;
}

function lastEnabled(options: readonly ComboboxOption[]): string | null {
  for (let i = options.length - 1; i >= 0; i--) {
    const o = options[i];
    if (o && !o.disabled) return o.id;
  }
  return null;
}

/** Next enabled option after `activeId`, or `activeId` unchanged if there is
 * none (no wrap — see the module doc). */
function nextEnabled(
  options: readonly ComboboxOption[],
  activeId: string | null,
): string | null {
  const idx = options.findIndex((o) => o.id === activeId);
  for (let i = idx + 1; i < options.length; i++) {
    const o = options[i];
    if (o && !o.disabled) return o.id;
  }
  return activeId ?? firstEnabled(options);
}

/** Previous enabled option before `activeId`, or `activeId` unchanged if
 * there is none (no wrap). */
function prevEnabled(
  options: readonly ComboboxOption[],
  activeId: string | null,
): string | null {
  const idx =
    activeId === null ? -1 : options.findIndex((o) => o.id === activeId);
  const start = idx === -1 ? options.length : idx;
  for (let i = start - 1; i >= 0; i--) {
    const o = options[i];
    if (o && !o.disabled) return o.id;
  }
  return activeId ?? lastEnabled(options);
}

/** Active option to use when opening: the current selection if it's visible
 * and enabled, else the first enabled option. */
function activeOnOpen(
  options: readonly ComboboxOption[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null) {
    const selected = options.find((o) => o.id === selectedId);
    if (selected && !selected.disabled) return selectedId;
  }
  return firstEnabled(options);
}

function commit(
  state: ComboboxState,
  ctx: ComboboxContext,
  id: string | null,
): ComboboxState {
  if (id === null) {
    // Nothing active to commit (e.g. every option disabled, or an empty
    // list) — just close, per "Tab never traps focus".
    return { ...state, open: false };
  }
  return {
    ...state,
    open: false,
    selectedId: id,
    activeId: id,
    query: ctx.labelOf(id),
  };
}

export function comboboxReducer(
  state: ComboboxState,
  action: ComboboxAction,
  ctx: ComboboxContext,
): ComboboxState {
  switch (action.type) {
    case "input": {
      // Typing always opens and resets the active option to the first match
      // in the (already re-filtered by the caller) option list.
      return {
        ...state,
        open: true,
        query: action.query,
        activeId: firstEnabled(ctx.options),
      };
    }

    case "arrowDown": {
      if (!state.open) {
        return {
          ...state,
          open: true,
          activeId: activeOnOpen(ctx.options, state.selectedId),
        };
      }
      return { ...state, activeId: nextEnabled(ctx.options, state.activeId) };
    }

    case "arrowUp": {
      if (!state.open) {
        return { ...state, open: true, activeId: lastEnabled(ctx.options) };
      }
      return { ...state, activeId: prevEnabled(ctx.options, state.activeId) };
    }

    case "home": {
      if (!state.open) return state;
      return { ...state, activeId: firstEnabled(ctx.options) };
    }

    case "end": {
      if (!state.open) return state;
      return { ...state, activeId: lastEnabled(ctx.options) };
    }

    case "enter": {
      if (!state.open) return state;
      return commit(state, ctx, state.activeId);
    }

    case "escape": {
      if (state.open) return { ...state, open: false };
      if (state.query) return { ...state, query: "" };
      return state;
    }

    case "tab": {
      if (!state.open) return state;
      return commit(state, ctx, state.activeId);
    }

    case "blur": {
      if (!state.open) return state;
      return { ...state, open: false };
    }

    case "optionClick": {
      return commit(state, ctx, action.id);
    }

    case "optionsChanged": {
      const options = action.options;
      const activeStillPresent =
        state.activeId !== null &&
        options.some((o) => o.id === state.activeId && !o.disabled);
      return {
        ...state,
        activeId: activeStillPresent ? state.activeId : firstEnabled(options),
      };
    }
  }
}

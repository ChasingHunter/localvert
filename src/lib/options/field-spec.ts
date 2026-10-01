/**
 * The zod-free half of the options-form layer: the descriptor type, and the
 * small visibility/required checks `ToolRunner` needs on its first load. (The
 * form-only checks live in `./field-check.ts` so they stay out of that chunk.)
 *
 * A `FieldSpec` is plain, serialisable data. `describeFields` (`./fields.ts`,
 * which does import zod) derives it from a tool's schema at build time,
 * `toClientTool` puts it in the tool's `ClientTool` (ADR-0019), and the main
 * thread renders and checks the form from it without ever loading zod.
 *
 * Nothing in this file may import zod, or anything that does: the main-thread
 * import-graph test (`src/lib/options/no-zod-on-main.test.ts`) walks from
 * `ToolRunner` and fails if zod becomes reachable.
 */

import type { ShowWhen } from "@/lib/registry/types";

export type { ShowWhen };

/**
 * Describes one form field for a tool's options schema. `describeFields`
 * derives these from the zod schema's `.meta()` — see `OptionMeta` in
 * `src/lib/registry/types.ts` for the meta shape tool authors write.
 */
export type FieldSpec = {
  key: string;
  label: string;
  help?: string;
  unit?: string;
  /** See the `required` doc comment in `src/lib/registry/types.ts`. */
  required?: boolean;
  /** See the `showWhen` doc comment in `src/lib/registry/types.ts`. */
  showWhen?: ShowWhen;
} & (
  | { control: "switch" }
  | { control: "select"; options: readonly { value: string; label: string }[] }
  | {
      control: "slider";
      min: number;
      max: number;
      step: number;
      /** A unitless 0..1 slider (quality, opacity): the form shows it as a
       * percent ("85%") while the stored value stays 0..1. See
       * `isPercentSlider` in `./fields.ts`. */
      percent?: boolean;
      /** The schema is `.int()`; see `validateFields`. */
      integer?: boolean;
      /** The schema accepts `undefined` (`.optional()`/`.default()`). */
      optional?: boolean;
    }
  | {
      control: "number";
      /** Absent = unbounded (JSON can't carry `Infinity`). */
      min?: number;
      max?: number;
      /** Absent = the browser's default step. */
      step?: number;
      /** `.positive()`-style: the value must be strictly greater than `min`. */
      exclusiveMin?: boolean;
      integer?: boolean;
      optional?: boolean;
    }
  | { control: "text" }
  | { control: "password" }
  | { control: "crop" }
  | { control: "hidden" }
);

/** Whether the form renders this field (crop and hidden ones never do). */
export function isFormField(field: FieldSpec): boolean {
  return field.control !== "crop" && field.control !== "hidden";
}

/**
 * Whether `field` should be rendered, given the option values currently in
 * the form — the read side of `showWhen` (see its doc comment in
 * `src/lib/registry/types.ts`). No `showWhen` means always visible. A field
 * that fails this check is left out of the form entirely, but `OptionsForm`
 * never touches its value — it stays whatever it already was, so flipping
 * the controlling field back and forth doesn't lose it.
 */
export function isFieldVisible(
  field: Pick<FieldSpec, "showWhen">,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (!field.showWhen) return true;
  const current = values[field.showWhen.field];
  const { equals } = field.showWhen;
  return Array.isArray(equals)
    ? (equals as readonly unknown[]).includes(current)
    : current === equals;
}

/**
 * Whether every `required` field (see the doc comment in
 * `src/lib/registry/types.ts`) currently holds a non-blank value — a
 * required field is a valid zod value even when empty (e.g. `protect-pdf`'s
 * `password` has no `.min(1)`), so this is a separate, UI-only check from
 * `validateFields`. A non-string required value only needs to exist
 * (`undefined`/`null` fail it); a string one also can't be
 * whitespace-only. A required field hidden by `showWhen` is skipped.
 * `OptionsForm` and `ToolRunner` gate the run/convert action on this.
 */
export function requiredFieldsSatisfied(
  fields: readonly Pick<FieldSpec, "key" | "required" | "showWhen">[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  return fields
    .filter((field) => field.required && isFieldVisible(field, values))
    .every((field) => {
      const value = values[field.key];
      if (typeof value === "string") return value.trim() !== "";
      return value !== undefined && value !== null;
    });
}

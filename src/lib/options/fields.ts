import { z } from "zod";
import type { FieldSpec } from "./field-spec";

export { formatPercent, validateFields } from "./field-check";
export type { FieldSpec, ShowWhen } from "./field-spec";
export { isFieldVisible, requiredFieldsSatisfied } from "./field-spec";

/**
 * A select option's display text: the tool's own `optionLabels` entry if it
 * has one, else the enum value with `-`/`_` separators turned into spaces
 * (`"target-size"` → "target size"). Case is left alone on purpose — many
 * enums are format ids (`jpg`, `mp3`) where naive capitalization ("Jpg")
 * reads worse than the raw value; tools that want proper wording declare it.
 */
export function optionLabel(
  value: string,
  labels?: Record<string, string>,
): string {
  return labels?.[value] ?? value.replace(/[-_]+/g, " ");
}

type CoreField = z.core.$ZodType;

function fieldError(key: string, message: string): never {
  throw new Error(`[options] field ${key}: ${message}`);
}

/**
 * Peels off `ZodOptional`/`ZodDefault` wrappers to reach the schema a tool
 * author called `.meta()` and the control-matching checks below against —
 * `.optional()`/`.default()` clone their inner type, so the clone `.meta()`
 * was registered on survives underneath the wrapper.
 */
function unwrap(field: CoreField): CoreField {
  const { type } = field._zod.def;
  if (type === "optional" || type === "default") {
    const { innerType } = field._zod.def as unknown as {
      innerType: CoreField;
    };
    return unwrap(innerType);
  }
  return field;
}

/** Whether the schema accepts `undefined` (`.optional()` / `.default()`). */
function acceptsUndefined(field: CoreField): boolean {
  const { type } = field._zod.def;
  return type === "optional" || type === "default";
}

/** Runtime shape of the classic `ZodNumber`/`ZodNumberFormat` getters. */
interface NumberLike {
  minValue: number | null;
  maxValue: number | null;
  format: string | null;
}

interface CheckLike {
  _zod: { def: { check: string; inclusive?: boolean } };
}

/**
 * The main thread checks a form from its descriptors alone
 * (`validateFields`, ADR-0019), so a field may only carry the zod checks a
 * descriptor can express: a number's int/min/max, and nothing on a
 * string/enum/boolean. Anything else (a `.regex()`, `.multipleOf()`...) would
 * be silently unchecked in the form, so it fails here, at generation time,
 * with the way out: do that check in the engine.
 */
function assertDescribableChecks(
  key: string,
  field: CoreField,
  allowed: readonly string[],
): readonly CheckLike[] {
  const checks = (field._zod.def as { checks?: readonly CheckLike[] }).checks;
  for (const check of checks ?? []) {
    if (!allowed.includes(check._zod.def.check)) {
      fieldError(
        key,
        `carries a "${check._zod.def.check}" zod check the client form can't ` +
          "run (ADR-0019); validate it in the engine instead",
      );
    }
  }
  return checks ?? [];
}

const NUMBER_CHECKS = ["greater_than", "less_than", "number_format"] as const;

/**
 * A slider that runs 0..1 with no unit of its own is a fraction (quality,
 * opacity), which people read as a percent. The stored value is untouched;
 * only the form's readout changes. Documented on `OptionMeta` in
 * `src/lib/registry/types.ts`.
 */
function isPercentSlider(
  control: string,
  min: number,
  max: number,
  unit: string | undefined,
): boolean {
  return control === "slider" && unit === undefined && min >= 0 && max === 1;
}

function isFiniteBound(n: number | null): n is number {
  return n !== null && Number.isFinite(n);
}

function describeField(key: string, rawField: CoreField): FieldSpec {
  const field = unwrap(rawField);
  const optional = acceptsUndefined(rawField);
  const meta = z.globalRegistry.get(field);
  if (meta === undefined || !meta.label || !meta.control) {
    fieldError(
      key,
      "needs .meta({ label, control }) — every option field must declare both",
    );
  }
  const { type } = field._zod.def;
  const { label, control, unit, help, required, showWhen } = meta;
  const base = {
    key,
    label,
    ...(unit !== undefined && { unit }),
    ...(help !== undefined && { help }),
    ...(required !== undefined && { required }),
    ...(showWhen !== undefined && { showWhen }),
  };

  switch (control) {
    case "switch": {
      if (type !== "boolean") {
        fieldError(
          key,
          `control "switch" needs a boolean field, got "${type}"`,
        );
      }
      assertDescribableChecks(key, field, []);
      return { ...base, control };
    }
    case "select": {
      if (type !== "enum") {
        fieldError(key, `control "select" needs an enum field, got "${type}"`);
      }
      assertDescribableChecks(key, field, []);
      const { entries } = field._zod.def as unknown as {
        entries: Record<string, string>;
      };
      const options = Object.values(entries).map((value) => ({
        value,
        label: optionLabel(value, meta.optionLabels),
      }));
      return { ...base, control, options };
    }
    case "slider":
    case "number": {
      if (type !== "number") {
        fieldError(
          key,
          `control "${control}" needs a number field, got "${type}"`,
        );
      }
      const checks = assertDescribableChecks(key, field, NUMBER_CHECKS);
      const numberField = field as unknown as NumberLike;
      const { minValue, maxValue } = numberField;
      if (
        control === "slider" &&
        !(isFiniteBound(minValue) && isFiniteBound(maxValue))
      ) {
        fieldError(
          key,
          'control "slider" needs finite .min() and .max() bounds',
        );
      }
      const integer = numberField.format === "safeint";
      const exclusiveMin = checks.some(
        (c) => c._zod.def.check === "greater_than" && !c._zod.def.inclusive,
      );
      const min = isFiniteBound(minValue) ? minValue : undefined;
      const max = isFiniteBound(maxValue) ? maxValue : undefined;
      const derivedStep =
        min !== undefined && max !== undefined ? (max - min) / 100 : undefined;
      const step = meta.step ?? (integer ? 1 : derivedStep);
      const flags = {
        ...(integer && { integer }),
        ...(optional && { optional }),
      };
      if (control === "slider") {
        // Finite bounds and a step are guaranteed by the check above.
        const sliderMin = min ?? 0;
        const sliderMax = max ?? 0;
        return {
          ...base,
          control,
          min: sliderMin,
          max: sliderMax,
          step: step ?? 1,
          ...flags,
          ...(isPercentSlider(control, sliderMin, sliderMax, unit) && {
            percent: true,
          }),
        };
      }
      return {
        ...base,
        control,
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        ...(step !== undefined && Number.isFinite(step) && { step }),
        ...(exclusiveMin && { exclusiveMin }),
        ...flags,
      };
    }
    case "text": {
      if (type !== "string") {
        fieldError(key, `control "text" needs a string field, got "${type}"`);
      }
      assertDescribableChecks(key, field, []);
      return { ...base, control };
    }
    case "password": {
      // Same underlying field shape as "text" — a password is a string —
      // rendered as `<input type="password">` instead so it isn't echoed to
      // the screen (see `OptionsForm`'s `FieldControl`).
      if (type !== "string") {
        fieldError(
          key,
          `control "password" needs a string field, got "${type}"`,
        );
      }
      assertDescribableChecks(key, field, []);
      return { ...base, control };
    }
    case "crop": {
      // The crop rectangle itself — {x,y,width,height} in source pixels
      // (`src/tools/_shared-options.ts`'s `cropField`). No min/max/options to
      // derive: `CropEditor` (`src/components/crop-editor.tsx`) reads the
      // dropped image's own dimensions at runtime instead, and `OptionsForm`
      // never renders this control — it's filtered out in favor of the
      // dedicated editor (see options-form.tsx).
      if (type !== "object") {
        fieldError(key, `control "crop" needs an object field, got "${type}"`);
      }
      return { ...base, control };
    }
    case "hidden": {
      // An engine-only parameter with a single fixed value per tool — e.g.
      // `delete-pdf-pages`/`extract-pdf-pages` both drive the pdf-lib
      // engine's one `extract` op, distinguished only by a `mode` value
      // that's baked into each tool's own `defaults`, never user-chosen. No
      // widget shape to validate the field against (unlike every other
      // control here, this one isn't UI-driven) — carried through the
      // options schema so it still reaches `EngineTask.options` like any
      // other field, but `OptionsForm` filters it out of the rendered form,
      // the same way it already filters "crop".
      return { ...base, control };
    }
  }
}

/**
 * Derives the option form's field list from a tool's zod options schema, in
 * declaration order. Every field must carry `.meta({ label, control })` (see
 * `OptionMeta`) — a field missing meta, or whose `control` doesn't match its
 * zod type, is a tool-author bug and throws loudly rather than silently
 * dropping the field from the form.
 */
export function describeFields(schema: z.ZodObject): FieldSpec[] {
  return Object.entries(schema.shape).map(([key, field]) =>
    describeField(key, field as CoreField),
  );
}

export type ValidateResult<S extends z.ZodObject> =
  | { ok: true; value: z.infer<S> }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates a candidate options value against its schema. On failure,
 * returns one message per top-level field (the first issue wins if a field
 * has more than one) — enough to annotate `OptionsForm` fields without
 * exposing zod's internal error tree to the UI.
 */
export function validateOptions<S extends z.ZodObject>(
  schema: S,
  value: unknown,
): ValidateResult<S> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return { ok: false, errors };
}

import { z } from "zod";

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
  /** See the `showWhen` doc comment in `src/lib/registry/types.ts`. */
  showWhen?: {
    field: string;
    equals: string | number | boolean | readonly (string | number | boolean)[];
  };
} & (
  | { control: "switch" }
  | { control: "select"; options: readonly { value: string; label: string }[] }
  | { control: "slider" | "number"; min: number; max: number; step: number }
  | { control: "text" }
  | { control: "crop" }
);

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

/** Runtime shape of the classic `ZodNumber`/`ZodNumberFormat` getters. */
interface NumberLike {
  minValue: number | null;
  maxValue: number | null;
  format: string | null;
}

function isFiniteBound(n: number | null): n is number {
  return n !== null && Number.isFinite(n);
}

function describeField(key: string, rawField: CoreField): FieldSpec {
  const field = unwrap(rawField);
  const meta = z.globalRegistry.get(field);
  if (meta === undefined || !meta.label || !meta.control) {
    fieldError(
      key,
      "needs .meta({ label, control }) — every option field must declare both",
    );
  }
  const { type } = field._zod.def;
  const { label, control, unit, help, showWhen } = meta;
  const base = {
    key,
    label,
    ...(unit !== undefined && { unit }),
    ...(help !== undefined && { help }),
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
      return { ...base, control };
    }
    case "select": {
      if (type !== "enum") {
        fieldError(key, `control "select" needs an enum field, got "${type}"`);
      }
      const { entries } = field._zod.def as unknown as {
        entries: Record<string, string>;
      };
      const options = Object.values(entries).map((value) => ({
        value,
        label: value,
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
      const min = minValue ?? Number.NEGATIVE_INFINITY;
      const max = maxValue ?? Number.POSITIVE_INFINITY;
      const step =
        meta.step ?? (numberField.format === "safeint" ? 1 : (max - min) / 100);
      return { ...base, control, min, max, step };
    }
    case "text": {
      if (type !== "string") {
        fieldError(key, `control "text" needs a string field, got "${type}"`);
      }
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

/**
 * Whether `field` should be rendered, given the option values currently in
 * the form — the read side of `showWhen` (see its doc comment in
 * `src/lib/registry/types.ts`). No `showWhen` means always visible. A field
 * that fails this check is left out of the form entirely, but `OptionsForm`
 * never touches its value — it stays whatever it already was, so flipping
 * the controlling field back and forth doesn't lose it.
 */
export function isFieldVisible(
  field: FieldSpec,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (!field.showWhen) return true;
  const current = values[field.showWhen.field];
  const { equals } = field.showWhen;
  return Array.isArray(equals)
    ? (equals as readonly unknown[]).includes(current)
    : current === equals;
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

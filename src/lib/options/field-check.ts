/**
 * Form-only checks over `FieldSpec` descriptors, zod-free (ADR-0019). Kept out
 * of `./field-spec.ts` on purpose: that module is imported by `ToolRunner`
 * (first-load JS) and the bundler ships a module whole, so everything only
 * `OptionsForm` needs lives here, in the lazily loaded form chunk.
 */
import type { FieldSpec } from "./field-spec";

/** "85%" for a stored 0.85. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function receivedType(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return typeof value;
}

/**
 * The main thread's field-level check: one message per field with a bad
 * value (the first problem wins), worded exactly as zod words it, so the form
 * reads the same as it did when zod ran here. It covers what a descriptor can
 * express: a number's type, `.int()`, and min/max. `describeFields` refuses a
 * string/enum/boolean field that carries a zod check, so nothing else needs
 * checking here; the authoritative `schema.parse` still runs in the worker
 * before any job starts (ADR-0019). `src/lib/options/fields.test.ts` pins this
 * against zod's own messages.
 */
export function validateFields(
  fields: readonly FieldSpec[],
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.control !== "slider" && field.control !== "number") continue;
    const value = values[field.key];
    if (value === undefined && field.optional) continue;
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors[field.key] =
        `Invalid input: expected number, received ${receivedType(value)}`;
      continue;
    }
    if (field.integer && !Number.isSafeInteger(value)) {
      errors[field.key] = !Number.isInteger(value)
        ? "Invalid input: expected int, received number"
        : value > 0
          ? `Too big: expected int to be <=${Number.MAX_SAFE_INTEGER}`
          : `Too small: expected int to be >=${Number.MIN_SAFE_INTEGER}`;
      continue;
    }
    const exclusive = field.control === "number" && field.exclusiveMin === true;
    if (
      field.min !== undefined &&
      (exclusive ? value <= field.min : value < field.min)
    ) {
      errors[field.key] =
        `Too small: expected number to be ${exclusive ? ">" : ">="}${field.min}`;
      continue;
    }
    if (field.max !== undefined && value > field.max) {
      errors[field.key] = `Too big: expected number to be <=${field.max}`;
    }
  }
  return errors;
}

import { isFieldVisible } from "@/lib/options/field-spec";
import type { ReadinessRule } from "./types";

/**
 * Whether `options` satisfy a tool's `readiness` rule: see `ReadinessRule`.
 * Plain data in, plain boolean out, so `ToolRunner` can call it without
 * loading the tool itself (ADR-0019).
 */
export function isReady(
  rule: ReadinessRule,
  options: Readonly<Record<string, unknown>>,
): boolean {
  return (
    !isFieldVisible({ showWhen: rule.onlyWhen }, options) ||
    rule.anyPositive.some((key) => {
      const value = options[key];
      return typeof value === "number" && value > 0;
    })
  );
}

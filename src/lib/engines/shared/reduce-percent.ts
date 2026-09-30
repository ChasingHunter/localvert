/**
 * "Reduce by %" mode (ADR-0017): `target = source * (1 - percent/100)`,
 * after which the tool behaves exactly like target-size mode. Shared by
 * every compress adapter with a percent option, so the mapping is identical
 * everywhere.
 */

/** `percent` is 10-90 (a tool option's own validated range) — clamped here
 * too, defensively, since this runs inside a worker far from the zod schema
 * that validates the option value on the way in. */
export function percentToTargetBytes(
  sourceBytes: number,
  percent: number,
): number {
  const clamped = Math.min(90, Math.max(10, percent));
  return Math.max(1, Math.round(sourceBytes * (1 - clamped / 100)));
}

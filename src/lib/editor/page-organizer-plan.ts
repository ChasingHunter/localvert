/**
 * Shared plan shape + validation for the page organizer (E3) — used by both
 * the organizer UI (`src/components/editor/page-organizer.tsx`, which builds
 * and locally undo/redoes a plan) and the pdf-lib `organize` engine op
 * (`src/lib/engines/pdf-lib/adapter.ts`'s `runOrganize`), so the two can
 * never drift on what counts as a valid plan. Pure functions, no DOM/React/
 * pdf-lib import — safe to import from a worker or from client UI code
 * alike.
 */

export type PlanRotation = 0 | 90 | 180 | 270;

export interface BlankPageSize {
  width: number;
  height: number;
}

/** A4 in points (595.28 x 841.89) — `@cantoo/pdf-lib`'s own `PageSizes.A4`,
 * duplicated here as a plain constant so this module never needs to import
 * pdf-lib itself just to fall back to a default blank-page size. */
export const DEFAULT_BLANK_SIZE: BlankPageSize = {
  width: 595.28,
  height: 841.89,
};

/**
 * One tile in the organizer's plan: either an existing page (from the main
 * document or an inserted PDF, both addressed by `source` — an index into
 * the pdf-lib `organize` op's own `inputs` array, where `0` is always the
 * main document), or a blank page. `rotate` is always ADDED to whatever
 * rotation the source page already carries (same convention `rotate`'s own
 * op already uses) — for a blank page that's simply its own rotation, since
 * a fresh page starts at 0.
 */
export interface OrganizePlanEntry {
  source: number | "blank";
  /** 0-based page index into `source`'s document. Required unless `source`
   * is `"blank"`. */
  page?: number;
  rotate: PlanRotation;
  /** Blank pages only. Omitted, the caller should fall back to the
   * previous page's size, or `DEFAULT_BLANK_SIZE` if this is the first
   * page. */
  size?: BlankPageSize;
}

export type OrganizePlan = OrganizePlanEntry[];

export type ValidatePlanResult =
  | { ok: true; plan: OrganizePlan }
  | { ok: false; error: string };

const ROTATIONS = new Set<number>([0, 90, 180, 270]);

/**
 * `(current + delta) mod 360`, always non-negative — the same rule
 * `runRotate` already applies to a whole page-range rotate, generalized to
 * accept a delta that isn't necessarily one of the four allowed plan
 * rotations (a page's PRE-EXISTING rotation, read off a loaded PDF, can be
 * any multiple of 90, including ones a non-conforming writer left negative).
 */
export function normalizeRotation(current: number, delta: number): number {
  return (((current + delta) % 360) + 360) % 360;
}

/**
 * Validates a plan against `pageCounts` — the page count of every input
 * document, indexed the same way `source` is (`pageCounts[0]` is the main
 * document, `pageCounts[i]` the i-th inserted PDF). Returns a normalized
 * copy (never the original array/objects) on success, or a user-facing
 * error string describing the first problem found.
 */
export function validatePlan(
  plan: unknown,
  pageCounts: readonly number[],
): ValidatePlanResult {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: false, error: "The plan must have at least one page" };
  }

  const normalized: OrganizePlan = [];
  for (const [i, raw] of plan.entries()) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: `Entry ${i} is not an object` };
    }
    const entry = raw as Record<string, unknown>;

    if (!ROTATIONS.has(entry.rotate as number)) {
      return {
        ok: false,
        error: `Entry ${i} has an invalid rotate value (must be 0, 90, 180 or 270)`,
      };
    }
    const rotate = entry.rotate as PlanRotation;

    if (entry.source === "blank") {
      const rawSize = entry.size;
      let size: BlankPageSize | undefined;
      if (rawSize !== undefined) {
        const candidate = rawSize as Partial<BlankPageSize> | null;
        if (
          typeof candidate !== "object" ||
          candidate === null ||
          typeof candidate.width !== "number" ||
          typeof candidate.height !== "number" ||
          !(candidate.width > 0) ||
          !(candidate.height > 0)
        ) {
          return {
            ok: false,
            error: `Entry ${i} has an invalid blank page size`,
          };
        }
        size = { width: candidate.width, height: candidate.height };
      }
      normalized.push({ source: "blank", rotate, ...(size ? { size } : {}) });
      continue;
    }

    const source = entry.source;
    if (
      typeof source !== "number" ||
      !Number.isInteger(source) ||
      source < 0 ||
      source >= pageCounts.length
    ) {
      return {
        ok: false,
        error: `Entry ${i} names an unknown source document`,
      };
    }
    const pageCount = pageCounts[source] ?? 0;
    const page = entry.page;
    if (
      typeof page !== "number" ||
      !Number.isInteger(page) ||
      page < 0 ||
      page >= pageCount
    ) {
      return {
        ok: false,
        error: `Entry ${i} names page ${String(page)} of source ${source}, which has ${pageCount} page(s)`,
      };
    }

    normalized.push({ source, page, rotate });
  }

  return { ok: true, plan: normalized };
}

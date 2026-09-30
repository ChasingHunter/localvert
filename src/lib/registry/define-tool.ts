import { z } from "zod";
import { APP_IDS } from "./apps";
import { FORMATS } from "./formats";
import type { ToolDefinition } from "./types";

/**
 * zod normally JIT-compiles fast validators via a `new Function(...)` probe,
 * wrapped in try/catch so it degrades gracefully where that's unavailable.
 * Under this app's CSP (`script-src` carries no `'unsafe-eval'` — invariant
 * 1, never widened) the browser still reports a CSP violation for the probe
 * itself, even though the catch swallows the resulting error. `jitless`
 * skips the probe and runs zod's (still fully correct, just interpreted)
 * validator path instead — zod's own sanctioned escape hatch for exactly
 * this case. Set once here, at this module's top level: every tool file
 * calls `defineTool(...)` at module scope (`TOOL_LOADERS[slug]()` runs it),
 * and `defineTool` below is what actually touches a tool's zod schema first
 * (`options.safeParse(defaults)`) — so this runs before any zod validator in
 * the app is ever compiled, regardless of which tool loads first. Was
 * previously set from `tool-runner.tsx`, which worked but shipped zod in
 * every tool page's first-load bundle just to make this one call; living
 * here instead keeps zod out of the core bundle entirely (it now only loads
 * as part of a tool's own lazily-loaded chunk).
 */
z.config({ jitless: true });

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A field's `.meta()` can sit under `.optional()`/`.default()` — those
 * wrappers clone the inner type, so the clone `.meta()` was registered on
 * survives underneath. Mirrors (as a small local copy, not a shared import)
 * `src/lib/options/fields.ts`'s own `unwrap`: that module is a layer built
 * on top of the registry, and the registry doesn't reach back up into it.
 */
function unwrapField(field: z.core.$ZodType): z.core.$ZodType {
  const { type } = field._zod.def;
  if (type === "optional" || type === "default") {
    const { innerType } = field._zod.def as unknown as {
      innerType: z.core.$ZodType;
    };
    return unwrapField(innerType);
  }
  return field;
}

/**
 * Validates a tool definition at definition time — i.e. as soon as the tool
 * file's module runs, not later at build or test time — so a broken tool
 * file fails loudly before it can become a route promising a conversion the
 * registry can't actually resolve. Returns `def` unchanged; this is a check,
 * not a transform.
 */
export function defineTool<S extends z.ZodObject>(
  def: ToolDefinition<S>,
): ToolDefinition<S> {
  const fail = (message: string): never => {
    throw new Error(`[tool ${def.slug}] ${message}`);
  };

  if (!SLUG_RE.test(def.slug)) {
    fail(`slug "${def.slug}" must be lowercase kebab-case, e.g. "jpg-to-png"`);
  }
  if (def.title.trim() === "") {
    fail("title must not be empty");
  }
  if (def.description.trim() === "") {
    fail("description must not be empty");
  }

  if (def.accepts.length === 0) {
    fail("accepts must list at least one format");
  }
  for (const id of def.accepts) {
    if (!(id in FORMATS)) {
      fail(`accepts unknown format "${id}"`);
    }
  }
  if (def.produces !== "same" && !(def.produces in FORMATS)) {
    fail(`produces unknown format "${def.produces}"`);
  }

  const parsed = def.options.safeParse(def.defaults);
  if (!parsed.success) {
    fail(`defaults do not satisfy options: ${parsed.error.message}`);
  }

  const kind = def.kind ?? "job";
  if (kind === "app") {
    if (!def.app) {
      fail('kind "app" requires an "app" id');
    } else if (!(APP_IDS as readonly string[]).includes(def.app)) {
      fail(`app "${def.app}" is not a known APP_IDS entry`);
    }
  }
  if (kind === "job" && def.app) {
    fail('"app" is only allowed when kind is "app"');
  }

  if (def.rank !== undefined && (!Number.isInteger(def.rank) || def.rank < 1)) {
    fail(`rank (${def.rank}) must be a positive integer`);
  }
  if (
    def.categoryRank !== undefined &&
    (!Number.isInteger(def.categoryRank) || def.categoryRank < 1)
  ) {
    fail(`categoryRank (${def.categoryRank}) must be a positive integer`);
  }

  const arity = def.arity ?? "one-to-one";
  if (arity === "many-to-one") {
    // "batch" (repeat this tool per dropped file) and "many-to-one" (combine
    // every dropped file into one job) are mutually exclusive readings of a
    // multi-file drop — a tool can't ask for both at once. See ADR-0008 and
    // the `arity` doc comment on `ToolDefinition`.
    if (def.batch) {
      fail('arity "many-to-one" is incompatible with batch: true');
    }
    if (!def.actionLabel || def.actionLabel.trim() === "") {
      fail('arity "many-to-one" requires a non-empty actionLabel');
    }
  }

  if (def.pipeline.length === 0) {
    fail("pipeline must have at least one step");
  }
  def.pipeline.forEach((step, i) => {
    if (step.candidates.length === 0) {
      fail(`pipeline step ${i} ("${step.op}") has no engine candidates`);
    }
    const last = step.candidates[step.candidates.length - 1];
    if (last?.when) {
      fail(
        `pipeline step ${i} ("${step.op}")'s last candidate must have no ` +
          `"when" — otherwise the step can resolve to nothing on some browser`,
      );
    }
  });

  def.requiredOptionKeys = Object.entries(def.options.shape)
    .filter(([, field]) => {
      const meta = z.globalRegistry.get(unwrapField(field as z.core.$ZodType));
      return meta?.required === true;
    })
    .map(([key]) => key);

  // A required field can also be conditional (`showWhen`): hidden means not
  // required, so keep the condition next to the key for the UI to check.
  const showWhenByKey: Record<
    string,
    NonNullable<ToolDefinition["requiredOptionShowWhen"]>[string]
  > = {};
  for (const key of def.requiredOptionKeys) {
    const field = def.options.shape[key];
    const showWhen =
      field === undefined
        ? undefined
        : z.globalRegistry.get(unwrapField(field as z.core.$ZodType))?.showWhen;
    if (showWhen) showWhenByKey[key] = showWhen;
  }
  def.requiredOptionShowWhen = showWhenByKey;

  return def;
}

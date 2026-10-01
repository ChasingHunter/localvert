import { describeFields } from "@/lib/options/fields";
import type {
  ClientPipelineStep,
  ClientTool,
} from "@/lib/registry/client-tool";
import type { ToolDefinition } from "@/lib/registry/types";

/**
 * BUILD-TIME / TEST-TIME ONLY (imports zod). Projects a full tool definition
 * onto the plain data the main thread works from (ADR-0019). The tool page, a
 * server component, calls it while the site is exported; `client-tool.test.ts`
 * runs it over the whole registry. Never import this from a component, the job
 * engine or a worker.
 *
 * Throws, with the tool's slug, for anything a plain-data client can't carry:
 * a candidate `when` predicate, a non-JSON default, or an `outputName` that
 * isn't "keep the basename, take the extension from one select option".
 */
export function toClientTool(def: ToolDefinition): ClientTool {
  const fail = (message: string): never => {
    throw new Error(`[client-tool ${def.slug}] ${message}`);
  };

  const pipeline = def.pipeline.map((step, i): ClientPipelineStep => {
    for (const candidate of step.candidates) {
      if (candidate.when) {
        fail(
          `pipeline step ${i} candidate "${candidate.engine}" has a "when" ` +
            "predicate; the client resolves engines from plain data",
        );
      }
    }
    return {
      op: step.op,
      ...(step.from !== undefined && { from: step.from }),
      ...(step.to !== undefined && { to: step.to }),
      candidates: step.candidates.map((c) => ({ engine: c.engine })),
    };
  });

  const fields = describeFields(def.options);
  assertJsonSafe(def.defaults, "defaults", fail);

  const outputExtFromOption = def.outputName
    ? outputExtOption(def, fields, fail)
    : undefined;

  return {
    slug: def.slug,
    category: def.category,
    accepts: [...def.accepts],
    produces: def.produces,
    batch: def.batch,
    ...(def.arity !== undefined && { arity: def.arity }),
    ...(def.actionLabel !== undefined && { actionLabel: def.actionLabel }),
    ...(def.rangeStage !== undefined && { rangeStage: def.rangeStage }),
    ...(def.estimateKind !== undefined && { estimateKind: def.estimateKind }),
    ...(def.neverLarger !== undefined && { neverLarger: def.neverLarger }),
    ...(outputExtFromOption !== undefined && { outputExtFromOption }),
    ...(def.readiness !== undefined && { readiness: def.readiness }),
    pipeline,
    fields,
    defaults: def.defaults as Record<string, unknown>,
  };
}

/** The select option whose value is the output extension, found by asking the
 * tool's own `outputName` with each value. */
function outputExtOption(
  def: ToolDefinition,
  fields: ClientTool["fields"],
  fail: (message: string) => never,
): string {
  const outputName = def.outputName as (n: string, o: unknown) => string;
  for (const field of fields) {
    if (field.control !== "select") continue;
    const matches = field.options.every(
      ({ value }) =>
        outputName("clip.final.mov", {
          ...def.defaults,
          [field.key]: value,
        }) === `clip.final.${value}`,
    );
    if (matches) return field.key;
  }
  return fail(
    "outputName isn't expressible as data: it must keep the input's " +
      "basename and take the extension from one select option's value",
  );
}

function assertJsonSafe(
  value: unknown,
  path: string,
  fail: (message: string) => never,
): void {
  if (value === null || typeof value === "string") return;
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} is not JSON-safe (${value})`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      assertJsonSafe(v, `${path}[${i}]`, fail);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertJsonSafe(v, `${path}.${k}`, fail);
    }
    return;
  }
  fail(`${path} is not JSON-safe (${typeof value})`);
}

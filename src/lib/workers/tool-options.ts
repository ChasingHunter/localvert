import type { ToolDefinition } from "@/lib/registry/types";
import type { RunOutcome, RunRequest } from "./protocol";

type ToolLoaders = Readonly<
  Record<string, (() => Promise<{ default: ToolDefinition }>) | undefined>
>;

/**
 * Runs inside the worker (ADR-0019). The main thread sends a tool's raw form
 * values plus its slug; this loads the tool's real definition, so zod runs
 * here and never on the main thread, and replaces `options` with the
 * schema-parsed object (defaults applied, unknown keys dropped) the engines
 * have always received. A request with no `toolSlug` already carries final
 * options and passes through untouched.
 *
 * A value the schema rejects is returned as a failed `RunOutcome`, which the
 * job engine shows on that job's card like any other engine error. Before
 * ADR-0019 the same check threw from `submit`; the form's own field checks
 * (`validateFields`) keep an out-of-range number from reaching it in practice.
 */
export function createToolOptionsResolver(loaders: ToolLoaders) {
  return async function resolveToolOptions(
    req: RunRequest,
  ): Promise<
    { ok: true; req: RunRequest } | { ok: false; outcome: RunOutcome }
  > {
    if (req.toolSlug === undefined) return { ok: true, req };

    const loader = loaders[req.toolSlug];
    if (!loader) {
      return {
        ok: false,
        outcome: failure(`unknown tool "${req.toolSlug}"`),
      };
    }
    const tool = (await loader()).default;
    const parsed = tool.options.safeParse(req.options);
    if (!parsed.success) {
      return {
        ok: false,
        outcome: failure(`invalid options: ${parsed.error.message}`),
      };
    }
    return {
      ok: true,
      req: { ...req, options: parsed.data as Record<string, unknown> },
    };
  };
}

function failure(message: string): RunOutcome {
  return {
    ok: false,
    error: { name: "EngineError", code: "internal", message },
  };
}

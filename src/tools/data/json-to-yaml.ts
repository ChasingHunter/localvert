import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `data` engine's `transcode` op, json -> yaml (`yaml.stringify`, key
 * order preserved, indent fixed at 2 — see `src/lib/engines/data/
 * transforms.ts`'s `jsonToYaml`). No user-facing options: there's nothing
 * to choose for a JSON-to-YAML re-serialization.
 */
export default defineTool({
  slug: "json-to-yaml",
  category: "data",
  title: "JSON to YAML",
  description: "Convert JSON to YAML.",

  accepts: ["json"],
  produces: "yaml",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "json",
      to: "yaml",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});

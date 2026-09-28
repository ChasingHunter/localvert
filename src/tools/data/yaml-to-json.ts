import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `data` engine's `transcode` op, yaml -> json (`yaml.parse` then
 * `JSON.stringify(_, null, 2)` — see `src/lib/engines/data/transforms.ts`'s
 * `yamlToJson`). No user-facing options.
 */
export default defineTool({
  slug: "yaml-to-json",
  category: "data",
  title: "YAML to JSON",
  description: "Convert YAML to JSON.",

  accepts: ["yaml"],
  produces: "json",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "yaml",
      to: "json",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});

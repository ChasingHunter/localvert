import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * `rotate` is a `control: "select"` option, which `describeFields`
 * (`src/lib/options/fields.ts`) requires to be a real `z.enum(...)` — that
 * always parses to a string, and there's no `.transform()` that would turn
 * it into a number without breaking `defineTool`'s defaults-satisfy-options
 * check (a transform's input type and output type differ, but `defaults` is
 * parsed as input while its TS type is the output). So the value stays
 * "90"/"180"/"270" all the way to the engine; the `canvas` adapter's
 * `runRotate` coerces the string to a number before comparing (see its doc
 * comment). `.meta()` must come before `.default()` — same `unwrap` note as
 * every other option field in this slice.
 */
export default defineTool({
  slug: "rotate-jpg",
  category: "image",
  title: "Rotate JPG",
  description:
    "Rotate a JPG 90, 180, or 270 degrees clockwise — free, private, in " +
    "your browser. Files never leave your device. Re-encoding strips " +
    "embedded metadata, including GPS.",

  accepts: ["jpg"],
  produces: "jpg",

  options: z.object({
    rotate: z
      .enum(["90", "180", "270"])
      .meta({ label: "Rotate", control: "select" })
      .default("90"),
  }),
  defaults: { rotate: "90" },

  pipeline: imagePipeline("jpg", "jpg", ["rotate"]),

  batch: true,
});

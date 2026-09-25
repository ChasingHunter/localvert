import { defineTool, imagePipeline } from "@/lib/registry";
import { svgDefaults, svgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("jpg", "svg")` — see `png-to-svg.ts`'s doc
 * comment for the `tracer` engine's shape (trace, not pixel re-encode).
 */
export default defineTool({
  slug: "jpg-to-svg",
  category: "image",
  title: "JPG to SVG",
  description:
    "Convert JPG to SVG — trace images into scalable vectors, privately " +
    "in your browser. Free and private: runs entirely on your device, no " +
    "upload. Large images are traced at up to 1600 px on the long side.",

  accepts: ["jpg"],
  produces: "svg",

  options: svgOptions,
  defaults: svgDefaults,

  pipeline: imagePipeline("jpg", "svg"),

  batch: true,
});

import { defineTool, imagePipeline } from "@/lib/registry";
import { svgDefaults, svgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("png", "svg")` (ADR-0007: decode -> encode) —
 * resolves to `jsquash-png` decode and `tracer` encode. Unlike every other
 * `encode` step in the image matrix, `tracer` doesn't re-encode pixels: it
 * traces outlines from the decoded raster into vector paths (see
 * `src/lib/engines/tracer/adapter.ts`). `svgOptions`/`svgDefaults` are
 * shared with every other `*-to-svg` tool — see `src/tools/_shared-options.ts`.
 */
export default defineTool({
  slug: "png-to-svg",
  category: "image",
  title: "PNG to SVG",
  description:
    "Convert PNG to SVG — trace images into scalable vectors, privately " +
    "in your browser. Free and private: runs entirely on your device, no " +
    "upload. Large images are traced at up to 1600 px on the long side.",

  accepts: ["png"],
  produces: "svg",

  options: svgOptions,
  defaults: svgDefaults,

  pipeline: imagePipeline("png", "svg"),

  batch: true,
});

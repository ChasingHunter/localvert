import { defineTool, imagePipeline } from "@/lib/registry";
import { icoDefaults, icoOptions } from "../_shared-options";

/** Same fit-in-square-with-transparent-padding behavior as `png-to-ico` —
 * see that tool's doc comment. */
export default defineTool({
  slug: "jpg-to-ico",
  category: "image",
  title: "JPG to ICO",
  description:
    "Convert JPG to a Windows icon (.ico) — free and private, runs in " +
    "your browser. Writes every size the chosen preset needs in one file.",

  accepts: ["jpg"],
  produces: "ico",

  options: icoOptions,
  defaults: icoDefaults,

  pipeline: imagePipeline("jpg", "ico"),

  batch: true,
});

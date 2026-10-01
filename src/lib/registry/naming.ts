import type { JobTool } from "./client-tool";
import { FORMATS } from "./formats";

/**
 * The output filename for a converted file. Uses the tool's own
 * `outputName` when it has one; otherwise keeps the input's basename and
 * swaps its extension for the produced format's canonical one (`ext[0]`),
 * appending it if the input had no extension. Only the last extension is
 * replaced — `archive.tar.gz` becomes `archive.tar.<ext>`, not `archive.<ext>`.
 *
 * `produces: "same"` (e.g. `strip-exif`) has no fixed format to swap in —
 * the input's own extension is kept exactly as given (case included)
 * instead, since the output is always the same format the input already
 * was.
 *
 * A `ClientTool` (ADR-0019) has no `outputName` function; where the real tool
 * has one, it carries `outputExtFromOption` instead (the one shape in use:
 * the extension is an option's value), which this applies the same way.
 */
export function outputFileName(
  tool: Pick<JobTool, "produces" | "outputName" | "outputExtFromOption">,
  inputName: string,
  opts: unknown,
): string {
  if (tool.outputName) {
    // The tool's own function, typed for its own options schema.
    return (tool.outputName as (n: string, o: unknown) => string)(
      inputName,
      opts,
    );
  }
  if (tool.outputExtFromOption) {
    const ext = (opts as Record<string, unknown>)[tool.outputExtFromOption];
    if (typeof ext === "string" && ext !== "") {
      const dot = inputName.lastIndexOf(".");
      const base = dot === -1 ? inputName : inputName.slice(0, dot);
      return `${base}.${ext}`;
    }
  }
  if (tool.produces === "same") {
    return inputName;
  }
  const dot = inputName.lastIndexOf(".");
  const base = dot === -1 ? inputName : inputName.slice(0, dot);
  const ext = FORMATS[tool.produces].ext[0];
  return `${base}.${ext}`;
}

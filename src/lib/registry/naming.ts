import type { z } from "zod";
import { FORMATS } from "./formats";
import type { ToolDefinition } from "./types";

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
 */
export function outputFileName(
  tool: ToolDefinition,
  inputName: string,
  opts: unknown,
): string {
  if (tool.outputName) {
    return tool.outputName(inputName, opts as z.infer<typeof tool.options>);
  }
  if (tool.produces === "same") {
    return inputName;
  }
  const dot = inputName.lastIndexOf(".");
  const base = dot === -1 ? inputName : inputName.slice(0, dot);
  const ext = FORMATS[tool.produces].ext[0];
  return `${base}.${ext}`;
}

import type { z } from "zod";
import { FORMATS } from "./formats";
import type { ToolDefinition } from "./types";

/**
 * The output filename for a converted file. Uses the tool's own
 * `outputName` when it has one; otherwise keeps the input's basename and
 * swaps its extension for the produced format's canonical one (`ext[0]`),
 * appending it if the input had no extension. Only the last extension is
 * replaced — `archive.tar.gz` becomes `archive.tar.<ext>`, not `archive.<ext>`.
 */
export function outputFileName(
  tool: ToolDefinition,
  inputName: string,
  opts: unknown,
): string {
  if (tool.outputName) {
    return tool.outputName(inputName, opts as z.infer<typeof tool.options>);
  }
  const ext = FORMATS[tool.produces].ext[0];
  const dot = inputName.lastIndexOf(".");
  const base = dot === -1 ? inputName : inputName.slice(0, dot);
  return `${base}.${ext}`;
}

import { FORMATS } from "@/lib/registry/formats";
import { CATALOG } from "@/tools/catalog";

/**
 * Every input format some tool accepts, as the `accept` map the web app
 * manifest wants for both `file_handlers` and `share_target`: mime type ->
 * extensions, each with its leading dot (".jpg"). Derived from the generated
 * catalog, so a new tool's input format is registered with the OS on the next
 * `pnpm gen` and nobody edits a list by hand (ADR-0018).
 *
 * Formats that share a mime type merge into one entry. Extensions come from
 * the registry in declaration order, de-duplicated; mime keys are sorted so
 * the manifest is stable between builds.
 */
export function fileHandlerAccept(): Record<string, string[]> {
  const byMime = new Map<string, string[]>();
  for (const tool of CATALOG) {
    for (const format of tool.accepts) {
      const spec = FORMATS[format];
      const exts = byMime.get(spec.mime) ?? [];
      for (const ext of spec.ext) {
        const dotted = `.${ext}`;
        if (!exts.includes(dotted)) exts.push(dotted);
      }
      byMime.set(spec.mime, exts);
    }
  }
  return Object.fromEntries(
    [...byMime.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * The same set as a flat list, for `share_target.params.files[].accept`,
 * which takes mime types and extensions side by side.
 */
export function shareTargetAccept(): string[] {
  const accept = fileHandlerAccept();
  return [...Object.keys(accept), ...Object.values(accept).flat()];
}

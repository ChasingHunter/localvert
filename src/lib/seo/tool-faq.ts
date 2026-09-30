import { downloadBytes, enginesNeedingConsent } from "@/lib/engines/consent";
import { engineDisplayName } from "@/lib/engines/display-names";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { EngineManifestEntry } from "@/lib/engines/meta";
import { FORMATS } from "@/lib/registry/formats";
import type { ToolDefinition } from "@/lib/registry/types";

export interface FaqItem {
  question: string;
  /** Plain text. The same string is the visible answer and the JSON-LD answer. */
  answer: string;
  /** Optional link shown after the visible answer (not part of the JSON-LD text). */
  link?: { href: string; label: string };
}

type FaqTool = Pick<
  ToolDefinition,
  | "slug"
  | "title"
  | "kind"
  | "accepts"
  | "produces"
  | "pipeline"
  | "neverLarger"
  | "estimateKind"
>;

/** "JPEG, PNG or WebP". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * The output format is obvious when the title already names it ("JPG to
 * PNG", "Compress PDF"). Anything else ("PDF to Word", a tool that keeps the
 * input format) is worth one line.
 */
function outputIsObvious(tool: FaqTool): boolean {
  if (tool.produces === "same") return false;
  const spec = FORMATS[tool.produces];
  const title = tool.title.toLowerCase();
  return [spec.label, ...spec.ext].some((name) =>
    title.includes(name.toLowerCase()),
  );
}

/**
 * Two to four short Q&As for a tool page, built from registry facts only
 * (formats, flags, engine manifest), so they can't drift from what the tool
 * really does. `manifest` is injectable for tests.
 */
export function toolFaq(
  tool: FaqTool,
  manifest: Readonly<Record<string, EngineManifestEntry>> = ENGINE_MANIFEST,
): FaqItem[] {
  const items: FaqItem[] = [
    {
      question: "Is my file uploaded?",
      answer: `No. Your file is ${tool.kind === "app" ? "edited" : "converted"} in your browser and never leaves your device. The page's security policy blocks uploads, so it can't be sent anywhere.`,
      link: { href: "/privacy", label: "How we know" },
    },
  ];

  if (tool.accepts.length > 1 || !outputIsObvious(tool)) {
    const takes = joinLabels(tool.accepts.map((id) => FORMATS[id].label));
    const gives =
      tool.produces === "same"
        ? "gives you the same format back"
        : `gives you ${/^[AEIOU]/i.test(FORMATS[tool.produces].label) ? "an" : "a"} ${FORMATS[tool.produces].label}`;
    items.push({
      question: "What formats does it take?",
      answer: `It takes ${takes} files and ${gives}.`,
    });
  }

  if (
    tool.neverLarger ||
    tool.estimateKind ||
    tool.slug.startsWith("compress-")
  ) {
    items.push({
      question: "Can the file get bigger?",
      answer:
        "No. If it can't make the file smaller, you get the original back.",
    });
  }

  const engines = enginesNeedingConsent(tool, manifest);
  if (engines.length > 0) {
    const names = joinLabels(engines.map(engineDisplayName));
    const mb = Math.round(
      engines.reduce(
        (sum, id) => sum + downloadBytes(manifest[id] ?? { assets: [] }),
        0,
      ) /
        (1024 * 1024),
    );
    items.push({
      question: "Why does it download something first?",
      answer: `This one needs ${names}, about ${mb} MB. It asks before downloading, only does it once, and works offline after that. Your files still stay on your device.`,
    });
  }

  return items;
}

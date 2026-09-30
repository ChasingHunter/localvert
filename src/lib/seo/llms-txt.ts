import {
  categoriesWithTools,
  groupToolsByCategory,
} from "@/components/tool-groups";
import { CATEGORIES, CATEGORY_META } from "@/lib/registry";
import type { ToolDefinition } from "@/lib/registry/types";
import { SITE_URL } from "@/lib/site";

/** The pages that explain the site rather than convert a file. */
const ABOUT_LINKS = [
  {
    title: "How we know your files stay put",
    path: "/privacy",
    note: "How to check for yourself that nothing is uploaded.",
  },
  {
    title: "Make a file smaller",
    path: "/compress",
    note: "Compress images, PDF, video and audio.",
  },
  {
    title: "Compare Localvert",
    path: "/vs",
    note: "Against iLovePDF, Smallpdf and VERT.",
  },
] as const;

/**
 * `/llms.txt` (llmstxt.org): an H1, a blockquote summary, then H2 sections of
 * links. One section per category, generated from the tool list so a new
 * tool appears on the next build.
 */
export function buildLlmsTxt(tools: readonly ToolDefinition[]): string {
  const byCategory = groupToolsByCategory(tools);
  const sections = categoriesWithTools(CATEGORIES, byCategory).map(
    (category) => {
      const links = (byCategory.get(category) ?? []).map(
        (tool) =>
          `- [${tool.title}](${SITE_URL}/tools/${tool.slug}): ${tool.description}`,
      );
      return [`## ${CATEGORY_META[category].label}`, "", ...links].join("\n");
    },
  );
  const about = [
    "## About",
    "",
    ...ABOUT_LINKS.map(
      (link) => `- [${link.title}](${SITE_URL}${link.path}): ${link.note}`,
    ),
  ].join("\n");

  return `${[
    "# Localvert",
    "",
    "> A local-first file converter. Images, video, audio, PDF, documents and compression all run in your browser through WebAssembly, so your files are never uploaded.",
    "",
    ...sections.flatMap((section) => [section, ""]),
    about,
  ].join("\n")}\n`;
}

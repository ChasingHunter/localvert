import type { Category } from "@/lib/registry/categories";
import type { ToolDefinition } from "@/lib/registry/types";

/**
 * Groups tools by category, preserving `tools`' order within each group.
 * Shared by the home page, the category pages and `SiteHeader` (nav links
 * only appear for a category that actually has a tool) so the three stay in
 * sync without each re-deriving it — a new tool file shows up everywhere on
 * its next `pnpm gen`, no page edit required (docs/ADDING_A_TOOL.md).
 */
export function groupToolsByCategory(
  tools: readonly ToolDefinition[],
): Map<Category, ToolDefinition[]> {
  const byCategory = new Map<Category, ToolDefinition[]>();
  for (const tool of tools) {
    const list = byCategory.get(tool.category);
    if (list) list.push(tool);
    else byCategory.set(tool.category, [tool]);
  }
  return byCategory;
}

/** `categories` filtered down to the ones with at least one tool. */
export function categoriesWithTools(
  categories: readonly Category[],
  byCategory: ReadonlyMap<Category, ToolDefinition[]>,
): Category[] {
  return categories.filter((category) => byCategory.has(category));
}

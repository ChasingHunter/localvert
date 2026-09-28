import { describe, expect, it } from "vitest";
import { TOOLS } from "./index";

/**
 * Copy voice check (docs/adr/0016-visual-design.md's "Copy voice" section):
 * every tool's description is also its page's meta description, so it has
 * to read like a person wrote it, not a boilerplate generator. Runs over
 * the generated `TOOLS` barrel so a new tool file is covered automatically,
 * no list to keep in sync by hand.
 */
const BANNED_WORDS = [
  "seamless",
  "effortless",
  "powerful",
  "blazing",
  "supercharge",
  "unlock",
  "magic",
  "instantly",
  "easily",
  "simply",
  "just",
];
const bannedWordPattern = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");

describe.each(TOOLS.map((t) => [t.slug, t] as const))(
  "%s description",
  (_slug, tool) => {
    it("has no em dash", () => {
      expect(tool.description).not.toContain("—");
    });

    it("doesn't repeat the site-wide privacy boilerplate", () => {
      expect(tool.description).not.toContain("Free and private");
    });

    it("is 200 characters or fewer", () => {
      expect(tool.description.length).toBeLessThanOrEqual(200);
    });

    it("doesn't start with the title verbatim", () => {
      expect(tool.description.startsWith(tool.title)).toBe(false);
    });

    it("has no hype words", () => {
      expect(bannedWordPattern.test(tool.description)).toBe(false);
    });
  },
);

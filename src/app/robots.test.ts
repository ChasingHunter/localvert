import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/site";
import robots from "./robots";

describe("robots", () => {
  it("points at the sitemap on the production origin", () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it("allows all crawlers", () => {
    const { rules } = robots();
    expect(rules).toEqual({ userAgent: "*", allow: "/" });
  });
});

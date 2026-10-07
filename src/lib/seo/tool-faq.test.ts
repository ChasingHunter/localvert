import { describe, expect, it } from "vitest";
import { TOOLS, TOOLS_BY_SLUG } from "@/tools";
import { serializeJsonLd, toolJsonLd } from "./structured-data";
import { toolFaq } from "./tool-faq";

function faqFor(slug: string) {
  const tool = TOOLS_BY_SLUG.get(slug);
  if (!tool) throw new Error(`no tool ${slug}`);
  return toolFaq(tool);
}

describe("toolFaq", () => {
  it("gives every tool the upload question, at most four questions, no em dashes", () => {
    for (const tool of TOOLS) {
      const faq = toolFaq(tool);
      expect(faq[0]?.question, tool.slug).toBe("Is my file uploaded?");
      expect(faq[0]?.link?.href).toBe("/privacy");
      expect(faq.length, tool.slug).toBeLessThanOrEqual(4);
      for (const item of faq) {
        expect(item.question + item.answer, tool.slug).not.toContain("\u2014");
      }
    }
  });

  it("asks the bigger-file question on every compress tool", () => {
    for (const tool of TOOLS.filter((t) => t.slug.startsWith("compress-"))) {
      expect(
        toolFaq(tool).map((i) => i.question),
        tool.slug,
      ).toContain("Can the file get bigger?");
    }
  });

  it("skips the formats question when the title already names the output", () => {
    const questions = faqFor("compress-pdf").map((i) => i.question);
    expect(questions).not.toContain("What formats does it take?");
  });

  it("explains the format when the title does not name the output", () => {
    const answer = faqFor("pdf-to-word").find(
      (i) => i.question === "What formats does it take?",
    )?.answer;
    expect(answer).toMatch(/PDF/);
  });

  it("mentions the real download size for consent-gated engines", () => {
    const answer = faqFor("word-to-pdf").find(
      (i) => i.question === "Why does it download something first?",
    )?.answer;
    expect(answer).toMatch(/LibreOffice, about \d+ MB/);
  });

  it("asks nothing about downloads for tools with no consent-gated engine", () => {
    expect(faqFor("heic-to-jpg").map((i) => i.question)).not.toContain(
      "Why does it download something first?",
    );
  });
});

describe("toolJsonLd", () => {
  const tool = TOOLS_BY_SLUG.get("compress-pdf");
  if (!tool) throw new Error("compress-pdf missing");
  const faq = toolFaq(tool);
  const graph = toolJsonLd(tool, faq)["@graph"];

  it("round-trips as JSON with the three node types", () => {
    const parsed = JSON.parse(serializeJsonLd(toolJsonLd(tool, faq)));
    expect(
      parsed["@graph"].map((n: { "@type": string }) => n["@type"]),
    ).toEqual(["WebApplication", "BreadcrumbList", "FAQPage"]);
  });

  it("matches the FAQ text exactly", () => {
    const faqNode = graph[2] as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(
      faqNode.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]),
    ).toEqual(faq.map((i) => [i.question, i.answer]));
  });

  it("escapes < so data cannot close the script tag", () => {
    const out = serializeJsonLd({ text: "</script><b>" });
    expect(out).not.toContain("<");
    expect(out).toContain(String.raw`\u003c/script\u003e`);
    expect(JSON.parse(out).text).toBe("</script><b>");
  });
});

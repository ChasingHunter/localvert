import { describe, expect, it } from "vitest";
import {
  describeFields,
  validateFields,
  validateOptions,
} from "@/lib/options/fields";
import type { ClientTool } from "@/lib/registry/client-tool";
import { outputFileName } from "@/lib/registry/naming";
import { toClientTool } from "./client-tool";
import { TOOLS } from "./index";

/**
 * ADR-0019. The tool page projects every job tool onto `ClientTool` plain
 * data at build time, and the main thread runs on that instead of zod. These
 * tests pin that projection against the real tool definitions.
 */
const JOB_TOOLS = TOOLS.filter((tool) => tool.kind !== "app");

describe("toClientTool", () => {
  for (const tool of JOB_TOOLS) {
    it(`${tool.slug}: is plain data that survives JSON unchanged`, () => {
      const client = toClientTool(tool);
      // Props cross the server/client boundary and may be stored; nothing in
      // it can be a function, Infinity, NaN or undefined-valued.
      expect(JSON.parse(JSON.stringify(client))).toEqual(client);
    });

    it(`${tool.slug}: descriptors equal describeFields(tool.options)`, () => {
      expect(toClientTool(tool).fields).toEqual(describeFields(tool.options));
    });
  }
});

describe("client tool behaviour matches the real tool", () => {
  it("names output files the way the tool's own outputName does", () => {
    for (const tool of JOB_TOOLS) {
      const client: ClientTool = toClientTool(tool);
      for (const name of ["photo.jpg", "clip.final.mov", "noext"]) {
        expect(outputFileName(client, name, tool.defaults), tool.slug).toBe(
          outputFileName(tool, name, tool.defaults),
        );
      }
    }
  });

  it("extract-audio's extension follows its format option", () => {
    const tool = JOB_TOOLS.find((t) => t.slug === "extract-audio");
    expect(tool).toBeDefined();
    if (!tool) return;
    const client = toClientTool(tool);
    expect(client.outputExtFromOption).toBe("format");
    expect(
      outputFileName(client, "talk.mp4", { ...tool.defaults, format: "ogg" }),
    ).toBe("talk.ogg");
  });

  it("validates every number field with the same message zod gives", () => {
    for (const tool of JOB_TOOLS) {
      const fields = toClientTool(tool).fields;
      for (const field of fields) {
        if (field.control !== "slider" && field.control !== "number") continue;
        const probes: unknown[] = [
          undefined,
          Number.NaN,
          0,
          1.5,
          -1,
          field.min,
          field.max,
          field.min !== undefined ? field.min - 1 : -1,
          field.max !== undefined ? field.max + 1 : 1e9,
          tool.defaults[field.key as keyof typeof tool.defaults],
        ];
        for (const probe of probes) {
          const values = { ...tool.defaults, [field.key]: probe };
          const zodResult = validateOptions(tool.options, values);
          const zodMessage = zodResult.ok
            ? undefined
            : zodResult.errors[field.key];
          expect(
            validateFields(fields, values)[field.key],
            `${tool.slug}.${field.key} = ${String(probe)}`,
          ).toBe(zodMessage);
        }
      }
    }
  });
});

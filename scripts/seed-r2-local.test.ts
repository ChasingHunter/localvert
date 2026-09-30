import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { r2EngineIds, seedLocalR2 } from "./seed-r2-local";

describe("r2EngineIds", () => {
  it("finds the repo's r2-hosted engines from their engine.json", () => {
    expect(r2EngineIds(process.cwd())).toContain("ffmpeg");
  });
});

const FAKE_WRANGLER_BIN = "/fake/wrangler.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "seed-r2-local-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeFile(rootDir: string, relPath: string, content: string): void {
  const fullPath = join(rootDir, ...relPath.split("/"));
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
}

function writeWranglerJsonc(rootDir: string, bucketName: string): void {
  writeFile(
    rootDir,
    "infra/wrangler.jsonc",
    [
      "{",
      '  "r2_buckets": [',
      `    { "binding": "ENGINES", "bucket_name": "${bucketName}" }`,
      "  ]",
      "}",
    ].join("\n"),
  );
}

interface FakeExecCall {
  args: readonly string[];
}

function makeFakeExec() {
  const calls: FakeExecCall[] = [];
  const exec = (_command: string, args: readonly string[]): Buffer | string => {
    calls.push({ args });
    return Buffer.from("");
  };
  return { exec, calls };
}

describe("seedLocalR2", () => {
  it("returns an empty list when nothing is staged", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    const { exec, calls } = makeFakeExec();

    const seeded = seedLocalR2(dir, exec, FAKE_WRANGLER_BIN);

    expect(seeded).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("puts every staged file into the local R2 store, with --local and the right content-type", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    writeFile(dir, ".engines-r2/xl/ffmpeg--1.0.0/ffmpeg-core.wasm", "w");
    writeFile(dir, ".engines-r2/xl/ffmpeg--1.0.0/ffmpeg-core.js", "j");
    const { exec, calls } = makeFakeExec();

    const seeded = seedLocalR2(dir, exec, FAKE_WRANGLER_BIN);

    expect(seeded).toEqual([
      "xl/ffmpeg--1.0.0/ffmpeg-core.js",
      "xl/ffmpeg--1.0.0/ffmpeg-core.wasm",
    ]);
    expect(calls).toHaveLength(2);
    for (const { args } of calls) {
      expect(args).toContain("--local");
      expect(args).not.toContain("--remote");
      expect(args[1]).toBe("r2");
      expect(args[2]).toBe("object");
      expect(args[3]).toBe("put");
    }
    const jsCall = calls.find((c) =>
      c.args.some((a) => a.endsWith("ffmpeg-core.js")),
    );
    expect(jsCall?.args).toContain(
      "localvert-engines/xl/ffmpeg--1.0.0/ffmpeg-core.js",
    );
    expect(jsCall?.args).toContain("text/javascript");
    const wasmCall = calls.find((c) =>
      c.args.some((a) => a.endsWith("ffmpeg-core.wasm")),
    );
    expect(wasmCall?.args).toContain("application/wasm");
  });

  it("re-seeds every rerun rather than skipping existing keys", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    writeFile(dir, ".engines-r2/xl/foo--1.0.0/foo.wasm", "bytes");
    const { exec, calls } = makeFakeExec();

    seedLocalR2(dir, exec, FAKE_WRANGLER_BIN);
    seedLocalR2(dir, exec, FAKE_WRANGLER_BIN);

    expect(calls).toHaveLength(2);
  });
});

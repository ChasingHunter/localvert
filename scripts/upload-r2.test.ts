import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentTypeFor,
  type ExecFileSyncLike,
  findStagedFiles,
  readBucketName,
  stripJsonComments,
  uploadStaged,
  wranglerBinPath,
} from "./upload-r2";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "upload-r2-test-"));
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

/** A minimal `infra/wrangler.jsonc`, with the `//` comments the real file has. */
function writeWranglerJsonc(rootDir: string, bucketName: string): void {
  writeFile(
    rootDir,
    "infra/wrangler.jsonc",
    [
      "{",
      "  // a comment, like the real file has",
      '  "name": "localvert",',
      '  "r2_buckets": [',
      "    {",
      '      "binding": "ENGINES",',
      `      "bucket_name": "${bucketName}"`,
      "    }",
      "  ]",
      "}",
    ].join("\n"),
  );
}

interface FakeExecCall {
  args: readonly string[];
}

/**
 * A fake `ExecFileSyncLike` standing in for wrangler: `get` throws (i.e.
 * fails, like a missing object) unless its key is in `existingKeys`; `put`
 * always "succeeds". Every call is recorded in `calls` for assertions.
 */
function makeFakeExec(existingKeys: Set<string> = new Set()) {
  const calls: FakeExecCall[] = [];
  const exec: ExecFileSyncLike = (_command, args) => {
    calls.push({ args });
    const action = args[3];
    if (action === "get") {
      const bucketAndKey = args[4] ?? "";
      const key = bucketAndKey.split("/").slice(1).join("/");
      if (existingKeys.has(key)) return Buffer.from("");
      throw new Error("simulated: object not found");
    }
    if (action === "put") return Buffer.from("");
    throw new Error(`unexpected wrangler subcommand: ${String(action)}`);
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------
// contentTypeFor
// ---------------------------------------------------------------------------

describe("contentTypeFor", () => {
  it.each([
    ["ffmpeg-core.wasm", "application/wasm"],
    ["ffmpeg-core.js", "text/javascript"],
    ["worker.mjs", "text/javascript"],
    ["manifest.json", "application/json"],
    ["traineddata.bin", "application/octet-stream"],
    ["no-extension", "application/octet-stream"],
  ])("%s -> %s", (path, expected) => {
    expect(contentTypeFor(path)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// stripJsonComments / readBucketName
// ---------------------------------------------------------------------------

describe("stripJsonComments", () => {
  it("strips // line comments", () => {
    expect(stripJsonComments('{"a": 1} // trailing\n')).toBe('{"a": 1} \n');
  });

  it("strips /* */ block comments", () => {
    expect(stripJsonComments('{/* c */"a": 1}')).toBe('{"a": 1}');
  });

  it("leaves // and /* inside string literals alone", () => {
    const json = '{"url": "https://example.com/* not a comment */"}';
    expect(JSON.parse(stripJsonComments(json))).toEqual({
      url: "https://example.com/* not a comment */",
    });
  });
});

describe("readBucketName", () => {
  it("reads r2_buckets[0].bucket_name from a jsonc file", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    expect(readBucketName(join(dir, "infra", "wrangler.jsonc"))).toBe(
      "localvert-engines",
    );
  });

  it("matches the real infra/wrangler.jsonc shipped in this repo", () => {
    expect(readBucketName(join(process.cwd(), "infra", "wrangler.jsonc"))).toBe(
      "localvert-engines",
    );
  });

  it("throws a clear error when bucket_name is missing", () => {
    const dir = makeTempDir();
    writeFile(dir, "infra/wrangler.jsonc", "{}");
    expect(() => readBucketName(join(dir, "infra", "wrangler.jsonc"))).toThrow(
      /no r2_buckets\[0\]\.bucket_name found/,
    );
  });
});

// ---------------------------------------------------------------------------
// findStagedFiles
// ---------------------------------------------------------------------------

describe("findStagedFiles", () => {
  it("returns an empty list when nothing is staged", () => {
    expect(findStagedFiles(makeTempDir())).toEqual([]);
  });

  it("keys every staged file as xl/<id>@<version>/<file>, sorted", () => {
    const dir = makeTempDir();
    writeFile(dir, ".engines-r2/xl/ffmpeg-core@1.0.0/ffmpeg-core.wasm", "w");
    writeFile(dir, ".engines-r2/xl/ffmpeg-core@1.0.0/ffmpeg-core.js", "j");

    const staged = findStagedFiles(dir);

    expect(staged.map((s) => s.key)).toEqual([
      "xl/ffmpeg-core@1.0.0/ffmpeg-core.js",
      "xl/ffmpeg-core@1.0.0/ffmpeg-core.wasm",
    ]);
    expect(staged[0]?.contentType).toBe("text/javascript");
    expect(staged[1]?.contentType).toBe("application/wasm");
  });
});

// ---------------------------------------------------------------------------
// wranglerBinPath
// ---------------------------------------------------------------------------

describe("wranglerBinPath", () => {
  it("resolves the real installed wrangler binary in this repo", () => {
    const bin = wranglerBinPath(process.cwd());
    expect(existsSync(bin)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// uploadStaged
// ---------------------------------------------------------------------------

const FAKE_WRANGLER_BIN = "/fake/wrangler.js";

describe("uploadStaged", () => {
  it("does nothing, and needs no env, when nothing is staged", () => {
    const dir = makeTempDir();
    const { exec, calls } = makeFakeExec();

    const result = uploadStaged(dir, {}, exec, FAKE_WRANGLER_BIN);

    expect(result).toEqual({ uploaded: [], skipped: [] });
    expect(calls).toEqual([]);
  });

  it("fails fast when credentials are missing but work is staged", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    writeFile(dir, ".engines-r2/xl/foo@1.0.0/foo.wasm", "bytes");
    const { exec, calls } = makeFakeExec();

    expect(() => uploadStaged(dir, {}, exec, FAKE_WRANGLER_BIN)).toThrow(
      /CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set/,
    );
    expect(calls).toEqual([]); // fails before ever shelling out to wrangler
  });

  const creds = {
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_ACCOUNT_ID: "account",
  };

  it("skips a key that already exists in the bucket", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    writeFile(dir, ".engines-r2/xl/foo@1.0.0/foo.wasm", "bytes");
    const { exec, calls } = makeFakeExec(new Set(["xl/foo@1.0.0/foo.wasm"]));

    const result = uploadStaged(dir, creds, exec, FAKE_WRANGLER_BIN);

    expect(result).toEqual({
      uploaded: [],
      skipped: ["xl/foo@1.0.0/foo.wasm"],
    });
    // Only the existence check ran — never a put for an already-present key.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      FAKE_WRANGLER_BIN,
      "r2",
      "object",
      "get",
      "localvert-engines/xl/foo@1.0.0/foo.wasm",
      "--pipe",
      "--remote",
    ]);
  });

  it("puts a missing key with the right bucket/key, file, content-type and --remote", () => {
    const dir = makeTempDir();
    writeWranglerJsonc(dir, "localvert-engines");
    const stagedPath = join(dir, ".engines-r2", "xl", "foo@1.0.0", "foo.wasm");
    writeFile(dir, ".engines-r2/xl/foo@1.0.0/foo.wasm", "bytes");
    const { exec, calls } = makeFakeExec();

    const result = uploadStaged(dir, creds, exec, FAKE_WRANGLER_BIN);

    expect(result).toEqual({
      uploaded: ["xl/foo@1.0.0/foo.wasm"],
      skipped: [],
    });
    const putCall = calls.find((c) => c.args[3] === "put");
    expect(putCall?.args).toEqual([
      FAKE_WRANGLER_BIN,
      "r2",
      "object",
      "put",
      "localvert-engines/xl/foo@1.0.0/foo.wasm",
      "--file",
      stagedPath,
      "--content-type",
      "application/wasm",
      "--remote",
    ]);
  });
});

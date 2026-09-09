#!/usr/bin/env node
/**
 * PostToolUse hook: format the file Claude just edited with Biome.
 *
 * Fail-soft by design. PostToolUse cannot block (the edit already happened),
 * so a formatter that is missing, still installing, or unhappy with a
 * work-in-progress file must never interrupt the session. Every failure path
 * exits 0 silently.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FORMATTABLE = /\.(m?[jt]sx?|css|jsonc?)$/i;

/**
 * Biome ships a JS shim at bin/biome that execs the platform-specific binary.
 * Running it through process.execPath keeps us off the shell entirely, which
 * matters on Windows where the .bin shim is a .cmd and would otherwise need
 * cmd.exe — and a project path containing `&` would break the command line.
 */
function resolveBiome(projectDir) {
  const shim = join(projectDir, "node_modules", "@biomejs", "biome", "bin", "biome");
  return existsSync(shim) ? shim : null;
}

function main(payload) {
  const filePath = payload?.tool_input?.file_path;
  if (!filePath || !FORMATTABLE.test(filePath)) return;

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? payload?.cwd ?? process.cwd();
  if (!filePath.startsWith(projectDir)) return; // never touch files outside the repo

  const biome = resolveBiome(projectDir);
  if (!biome) return; // dependencies not installed yet

  execFileSync(process.execPath, [biome, "check", "--write", "--no-errors-on-unmatched", filePath], {
    cwd: projectDir,
    stdio: "ignore",
    timeout: 20_000,
  });
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    main(JSON.parse(input));
  } catch {
    // Fail soft: formatting is a convenience, never a gate. `pnpm verify` and
    // CI are the real enforcement.
  }
  process.exit(0);
});

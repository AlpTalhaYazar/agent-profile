/**
 * @file verify-fuses.test.ts
 *
 * Spawns `scripts/verify-fuses.mjs` against a non-existent binary path with
 * the `--strict` flag and asserts:
 *
 *   - Non-zero exit code (we picked `2` for the "missing binary in strict
 *     mode" case in the script).
 *   - A clear human-readable message mentioning the missing-binary remedy.
 *
 * The non-strict path is also exercised to confirm the script exits 0 with a
 * "no built binary" hint.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "scripts", "verify-fuses.mjs");

describe("scripts/verify-fuses.mjs", () => {
  it("exits non-zero in --strict mode when no binary exists", () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "/definitely/does/not/exist", "--strict"],
      { encoding: "utf8" }
    );
    expect(result.status).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toMatch(/no built binary/i);
  });

  it("exits 0 without --strict when no binary exists", () => {
    // Pass an explicit non-existent path so we don't accidentally pick up a
    // real `out/` directory on a developer machine.
    const result = spawnSync(process.execPath, [scriptPath, "/definitely/does/not/exist"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no built binary/i);
  });

  it("auto-discovery without args also exits 0 (no out/ directory)", () => {
    // Auto-discovery walks `apps/desktop/out/...`. We expect this to be
    // absent in the test sandbox; if a previous packaging step created one,
    // skip rather than fail the suite.
    const outDir = join(__dirname, "..", "out");
    if (existsSync(outDir)) return;
    const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no built binary/i);
  });
});

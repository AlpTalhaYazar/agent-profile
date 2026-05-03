#!/usr/bin/env node
/**
 * scripts/verify-fuses.mjs
 *
 * Verify that the packaged Electron binary has the security fuses we declared
 * in `forge.config.ts` actually flipped.
 *
 * Usage:
 *
 *   node ./scripts/verify-fuses.mjs [path-to-binary] [--strict]
 *
 * If a binary path is provided, that path is checked. Otherwise the script
 * auto-discovers the most likely Forge output:
 *
 *   - macOS:   out/AgentProfile-darwin-{arm64,x64}/AgentProfile.app/Contents/MacOS/AgentProfile
 *   - Linux:   out/AgentProfile-linux-{arm64,x64}/AgentProfile
 *   - Windows: out/AgentProfile-win32-x64/AgentProfile.exe
 *
 * If no binary is found, the script exits 0 with a "no built binary; run
 * `pnpm -C apps/desktop package` first" message — UNLESS `--strict` is passed,
 * in which case the missing binary is treated as a hard failure (exit 2). CI
 * jobs that conditionally package (e.g. only on `make` runs) call without
 * `--strict`; release jobs call with `--strict`.
 *
 * The expected fuse values mirror `docs/06-security.md` "Electron Fuses".
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const FUSE_STATE_DISABLE = "0".charCodeAt(0);
const FUSE_STATE_ENABLE = "1".charCodeAt(0);

/** The expected fuse values, keyed by FuseV1Options. Source of truth: docs/06-security.md. */
const EXPECTED = /** @type {Record<number, boolean>} */ ({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});

/** Pretty names for the report. */
const FUSE_NAMES = /** @type {Record<number, string>} */ ({
  [FuseV1Options.RunAsNode]: "RunAsNode",
  [FuseV1Options.EnableCookieEncryption]: "EnableCookieEncryption",
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: "EnableNodeOptionsEnvironmentVariable",
  [FuseV1Options.EnableNodeCliInspectArguments]: "EnableNodeCliInspectArguments",
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: "EnableEmbeddedAsarIntegrityValidation",
  [FuseV1Options.OnlyLoadAppFromAsar]: "OnlyLoadAppFromAsar",
});

/** Auto-discover candidate Forge outputs. */
function discoverBinary() {
  const outDir = join(desktopRoot, "out");
  const candidates = [
    join(
      outDir,
      "AgentProfile-darwin-arm64",
      "AgentProfile.app",
      "Contents",
      "MacOS",
      "AgentProfile"
    ),
    join(
      outDir,
      "AgentProfile-darwin-x64",
      "AgentProfile.app",
      "Contents",
      "MacOS",
      "AgentProfile"
    ),
    join(outDir, "AgentProfile-linux-arm64", "AgentProfile"),
    join(outDir, "AgentProfile-linux-x64", "AgentProfile"),
    join(outDir, "AgentProfile-win32-x64", "AgentProfile.exe"),
  ];
  return candidates.find((p) => existsSync(p));
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const positional = args.filter((a) => !a.startsWith("--"));
  const explicit = positional[0];

  const binary = explicit ? resolve(explicit) : discoverBinary();
  if (!binary || !existsSync(binary)) {
    const msg =
      "verify-fuses: no built binary found. Run `pnpm -C apps/desktop package` first to generate one under `apps/desktop/out/`.";
    if (strict) {
      console.error(msg);
      process.exit(2);
    }
    console.log(msg);
    process.exit(0);
  }

  console.log(`verify-fuses: inspecting ${binary}`);

  const wire = await getCurrentFuseWire(binary);
  if (wire.version !== FuseVersion.V1) {
    console.error(`verify-fuses: unsupported fuse version ${wire.version}; expected V1`);
    process.exit(2);
  }

  /** @type {Array<{name: string; expected: boolean; actual: boolean | undefined; ok: boolean}>} */
  const rows = [];
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const numeric = Number(key);
    const name = FUSE_NAMES[numeric] ?? `FuseV1Options[${numeric}]`;
    const actual = fuseStateToBoolean(wire[numeric]);
    rows.push({ name, expected, actual, ok: actual === expected });
  }

  const pad = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) {
    const status = r.ok ? "OK " : "FAIL";
    console.log(
      `  [${status}] ${r.name.padEnd(pad)}  expected=${String(r.expected)}  actual=${String(r.actual)}`
    );
  }

  const failed = rows.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`verify-fuses: ${failed.length} fuse(s) did not match expectations`);
    process.exit(1);
  }
  console.log("verify-fuses: all fuses match expected values");
  process.exit(0);
}

/**
 * `@electron/fuses.getCurrentFuseWire()` returns raw wire states, not
 * booleans: ASCII `0`/`1` byte values for disabled/enabled fuses.
 */
function fuseStateToBoolean(value) {
  if (value === true || value === FUSE_STATE_ENABLE) return true;
  if (value === false || value === FUSE_STATE_DISABLE) return false;
  return undefined;
}

main().catch((err) => {
  console.error("verify-fuses: unexpected error", err);
  process.exit(2);
});

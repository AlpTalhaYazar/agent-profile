/**
 * @module commands/version
 *
 * `myclaude version` — prints CLI version, core version, and Node version.
 * Supports `--json` for structured output.
 */
import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { writeJson } from "../output/json.js";

const _require = createRequire(import.meta.url);

// Build-time constants injected by tsup's `define`. At dev / test time these
// declarations are missing, so we fall back to reading package.json via
// createRequire below.
declare const __CLI_VERSION__: string | undefined;
declare const __CORE_VERSION__: string | undefined;

/**
 * Reads the version field from a package.json by package name.
 * In bundled builds, `@agent-profile/core` is resolved from the tsup-injected
 * constant since `require(...)` from a single-file bundle cannot walk
 * workspace symlinks reliably.
 */
export function readPackageVersion(pkgName: string): string {
  if (pkgName === "@agent-profile/core") {
    if (typeof __CORE_VERSION__ !== "undefined" && __CORE_VERSION__) {
      return __CORE_VERSION__;
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pkg = _require(`${pkgName}/package.json`) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Returns the CLI's own version. In bundled builds this comes from a
 * tsup-injected constant; at dev time it is read from package.json.
 */
export function cliVersion(): string {
  if (typeof __CLI_VERSION__ !== "undefined" && __CLI_VERSION__) {
    return __CLI_VERSION__;
  }
  try {
    const pkg = _require("../../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * `myclaude version` command definition.
 */
export const versionCommand = defineCommand({
  meta: {
    name: "version",
    description: "Print CLI version, core version, and Node version",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit structured JSON to stdout",
      alias: "j",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty-print JSON output (implies --json)",
      default: false,
    },
  },
  run({ args }) {
    const versions = {
      cli: cliVersion(),
      core: readPackageVersion("@agent-profile/core"),
      node: process.version,
    };

    if (args.json || args.pretty) {
      writeJson(versions, Boolean(args.pretty));
      return;
    }

    process.stdout.write(
      `myclaude  ${versions.cli}\ncore      ${versions.core}\nnode      ${versions.node}\n`
    );
  },
});

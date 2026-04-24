/**
 * @module commands/doctor
 *
 * `myclaude doctor` — environment diagnostics (stub for Sprint 2).
 *
 * Checks performed in this sprint:
 * - CLI version is readable.
 * - Core package version is readable.
 * - Node version meets minimum (≥ 22).
 * - All discovered scope files pass Zod validation.
 *
 * TODO(sprint-3): Add keychain probe (requires @agent-profile/secrets).
 * TODO(sprint-3): Add daemon reachability check (requires IPC).
 * TODO(sprint-3): Check that `claude` binary is on PATH.
 * TODO(sprint-3): Check shell integration (CLAUDE_CONFIG_DIR not aliased).
 */
import { createRequire } from "node:module";
import { loadScopeFile } from "@agent-profile/core";
import { defineCommand } from "citty";
import { green, red, yellow } from "../output/colors.js";
import { writeJson } from "../output/json.js";
import { discoverScopes } from "../utils/scope-discovery.js";

const _require = createRequire(import.meta.url);

/**
 * A single doctor check result.
 */
export interface DoctorCheck {
  /** Short name of the check. */
  name: string;
  /** `"pass"` | `"warn"` | `"fail"` | `"deferred"` */
  status: "pass" | "warn" | "fail" | "deferred";
  /** Human-readable message. */
  message: string;
  /** Optional fix hint. */
  hint?: string;
}

/**
 * Reads the version from a package.json by package name.
 */
function readVersion(pkgName: string): string {
  try {
    const pkg = _require(`${pkgName}/package.json`) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Reads the CLI version.
 */
function cliVersion(): string {
  try {
    const pkg = _require("../../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Checks the Node.js version meets the minimum requirement (≥ 22).
 */
export function checkNodeVersion(): DoctorCheck {
  const version = process.version; // e.g. "v22.0.0"
  const major = Number.parseInt(version.slice(1).split(".")[0] ?? "0", 10);
  if (major >= 22) {
    return {
      name: "node-version",
      status: "pass",
      message: `Node ${version} (≥ 22 required)`,
    };
  }
  return {
    name: "node-version",
    status: "fail",
    message: `Node ${version} is below the required minimum (v22)`,
    hint: "Install Node.js v22 LTS or newer.",
  };
}

/**
 * Checks that CLI and core package versions are readable.
 */
export function checkVersions(): DoctorCheck[] {
  const cli = cliVersion();
  const core = readVersion("@agent-profile/core");
  return [
    {
      name: "cli-version",
      status: cli !== "unknown" ? "pass" : "warn",
      message: `myclaude version: ${cli}`,
    },
    {
      name: "core-version",
      status: core !== "unknown" ? "pass" : "warn",
      message: `@agent-profile/core version: ${core}`,
    },
  ];
}

/**
 * Validates all discovered scope files.
 */
export function checkScopeFiles(home?: string, cwd?: string): DoctorCheck[] {
  const entries = discoverScopes({ home, cwd });
  if (entries.length === 0) {
    return [
      {
        name: "scope-files",
        status: "warn",
        message: "No scope files found",
        hint: "Create one with: myclaude profile create <role> --global",
      },
    ];
  }

  return entries.map((entry) => {
    try {
      loadScopeFile(entry.filePath);
      return {
        name: `scope:${entry.scope}/${entry.role}`,
        status: "pass" as const,
        message: `${entry.filePath}`,
      };
    } catch (err) {
      return {
        name: `scope:${entry.scope}/${entry.role}`,
        status: "fail" as const,
        message: `${entry.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        hint: "Fix the YAML and run again.",
      };
    }
  });
}

/**
 * Stub checks that are deferred to later sprints.
 */
export function deferredChecks(): DoctorCheck[] {
  return [
    {
      name: "claude-binary",
      status: "deferred",
      message: "claude binary check (deferred — Sprint 3)",
    },
    {
      name: "keychain",
      status: "deferred",
      message: "Keychain backend check (deferred — Sprint 4)",
    },
    {
      name: "daemon",
      status: "deferred",
      message: "Daemon reachability check (deferred — Phase 2)",
    },
  ];
}

/**
 * Renders a single check result to stdout.
 */
export function renderCheck(check: DoctorCheck): void {
  let prefix: string;
  switch (check.status) {
    case "pass":
      prefix = green("[✓]");
      break;
    case "warn":
      prefix = yellow("[!]");
      break;
    case "fail":
      prefix = red("[✗]");
      break;
    case "deferred":
      prefix = "[ ]";
      break;
  }
  process.stdout.write(`${prefix} ${check.message}\n`);
  if (check.hint && (check.status === "fail" || check.status === "warn")) {
    process.stdout.write(`    Fix: ${check.hint}\n`);
  }
}

/**
 * `myclaude doctor` command definition (stub).
 */
export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Environment diagnostics (stub: version + schema walk only)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit structured JSON",
      alias: "j",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
    cwd: {
      type: "string",
      description: "Override working directory (for testing)",
    },
  },
  run({ args }) {
    const checks: DoctorCheck[] = [
      checkNodeVersion(),
      ...checkVersions(),
      ...checkScopeFiles(args.home, args.cwd),
      ...deferredChecks(),
    ];

    const hasFailures = checks.some((c) => c.status === "fail");

    if (args.json) {
      writeJson({ checks, healthy: !hasFailures });
      if (hasFailures) process.exit(1);
      return;
    }

    for (const check of checks) {
      renderCheck(check);
    }

    if (hasFailures) {
      process.stdout.write("\nDiagnostics found issues. Run with --json for structured output.\n");
      process.exit(1);
    }
  },
});

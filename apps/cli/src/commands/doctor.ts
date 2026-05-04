/**
 * @module commands/doctor
 *
 * `myclaude doctor` — environment diagnostics.
 *
 * Checks performed:
 * - CLI version is readable.
 * - Core package version is readable.
 * - Node version meets minimum (≥ 22).
 * - All discovered scope files pass Zod validation.
 * - Keychain backend probe (Sprint 4).
 * - MYCLAUDE_ALLOW_PLAINTEXT warning (Sprint 4).
 * - Claude Code binary availability/version probe.
 * - Daemon reachability/status probe.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { loadScopeFile } from "@agent-profile/core";
import type { Backend } from "@agent-profile/secrets";
import { getBackend } from "@agent-profile/secrets";
import { defineCommand } from "citty";
import { CliError, EXIT_DAEMON_UNREACHABLE } from "../errors.js";
import { green, red, yellow } from "../output/colors.js";
import { writeJson } from "../output/json.js";
import { getTransport } from "../transport/index.js";
import type { TransportDaemonStatusResult } from "../transport/types.js";
import { discoverScopes } from "../utils/scope-discovery.js";

const _require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const DEFAULT_CLAUDE_VERSION_TIMEOUT_MS = 2000;
const DEFAULT_DAEMON_ATTEMPT_TIMEOUT_MS = 1000;

/**
 * A single doctor check result.
 */
export interface DoctorCheck {
  /** Short name of the check. */
  name: string;
  /** `"pass"` | `"warn"` | `"fail"` */
  status: "pass" | "warn" | "fail";
  /** Human-readable message. */
  message: string;
  /** Optional fix hint. */
  hint?: string;
}

/** Inputs for the injectable Claude version probe. */
export interface ClaudeVersionProbeInput {
  /** Resolved executable path. */
  commandPath: string;
  /** Environment passed to the subprocess. */
  env: NodeJS.ProcessEnv;
  /** Probe timeout in milliseconds. */
  timeoutMs: number;
}

/** Injectable surface for `claude --version`. */
export type ClaudeVersionProbe = (input: ClaudeVersionProbeInput) => Promise<string | null>;

/** Options for {@link checkClaudeBinary}. */
export interface CheckClaudeBinaryOptions {
  /** Environment used for PATH resolution and version probing. */
  env?: NodeJS.ProcessEnv;
  /** Injectable version probe for deterministic tests. */
  versionProbe?: ClaudeVersionProbe;
  /** Timeout for the default `claude --version` probe. */
  versionTimeoutMs?: number;
}

/** Inputs for the injectable daemon status probe. */
export interface DaemonStatusProbeInput {
  /** Override myclaude home directory. */
  home?: string;
  /** Timeout for daemon connection attempts. */
  attemptTimeoutMs?: number;
}

/** Injectable surface for daemon reachability/status. */
export type DaemonStatusProbe = (
  input: DaemonStatusProbeInput
) => Promise<TransportDaemonStatusResult>;

/** Options for {@link checkDaemonReachability}. */
export interface CheckDaemonReachabilityOptions {
  /** Override myclaude home directory. */
  home?: string;
  /** Environment used to honor forced standalone mode. */
  env?: NodeJS.ProcessEnv;
  /** Injectable status probe for deterministic tests. */
  statusProbe?: DaemonStatusProbe;
  /** Timeout for the default daemon connection probe. */
  attemptTimeoutMs?: number;
}

/** Options for running and rendering all doctor checks. */
export interface RunDoctorOptions {
  /** Emit structured JSON. */
  json?: boolean;
  /** Pretty-print JSON output (implies json). */
  pretty?: boolean;
  /** Override myclaude home directory. */
  home?: string;
  /** Override working directory. */
  cwd?: string;
  /** Injectable keychain backend for tests. */
  backend?: Backend;
  /** Injectable environment for tests. */
  env?: NodeJS.ProcessEnv;
  /** Injectable Claude version probe for tests. */
  claudeVersionProbe?: ClaudeVersionProbe;
  /** Injectable daemon status probe for tests. */
  daemonStatusProbe?: DaemonStatusProbe;
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
 * Checks the keychain backend.
 *
 * Returns a `[✓]` if a secure backend is available, `[✗]` for `basic-text`,
 * or `[!]` if `MYCLAUDE_ALLOW_PLAINTEXT=1` is set.
 *
 * @param backend - Optional injected backend (for tests).
 */
export async function checkKeychainBackend(
  backend?: Backend,
  env: NodeJS.ProcessEnv = process.env
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  let b: Backend;
  try {
    b = backend ?? (await getBackend());
  } catch (err) {
    checks.push({
      name: "keychain",
      status: "fail",
      message: `Keychain unavailable: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Ensure the keychain daemon is running.",
    });
    return checks;
  }

  if (b.kind === "basic-text") {
    checks.push({
      name: "keychain",
      status: "fail",
      message: "Keychain backend: basic-text — NOT secure.",
      hint:
        "Fix:\n" +
        "  Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring\n" +
        "  Fedora:         sudo dnf install libsecret\n" +
        "  Arch:           sudo pacman -S libsecret\n" +
        "Or set MYCLAUDE_ALLOW_PLAINTEXT=1 if this is a disposable CI container\n" +
        "(we recommend using runner-native secrets instead; see docs/06-security.md).",
    });
  } else if (b.kind === "unavailable") {
    checks.push({
      name: "keychain",
      status: "fail",
      message: "Keychain backend: unavailable.",
      hint: "Ensure the keychain daemon is running and accessible.",
    });
  } else {
    checks.push({
      name: "keychain",
      status: "pass",
      message: `Keychain backend: ${b.kind} (secure)`,
    });
  }

  // Warn if MYCLAUDE_ALLOW_PLAINTEXT is set.
  if (env.MYCLAUDE_ALLOW_PLAINTEXT === "1") {
    checks.push({
      name: "allow-plaintext",
      status: "warn",
      message: "MYCLAUDE_ALLOW_PLAINTEXT=1 set — plaintext credentials allowed.",
      hint: "Unset this for production credentials.",
    });
  }

  return checks;
}

/**
 * Checks that the CLI's default `claude` command is executable and reports a version.
 */
export async function checkClaudeBinary(opts: CheckClaudeBinaryOptions = {}): Promise<DoctorCheck> {
  const env = opts.env ?? process.env;
  const commandPath = await findExecutableOnPath("claude", env);

  if (!commandPath) {
    return {
      name: "claude-binary",
      status: "fail",
      message: 'Claude binary not found: expected executable "claude" on PATH',
      hint: "Install Claude Code and ensure `claude` is on PATH before running `myclaude launch`.",
    };
  }

  const version = await (opts.versionProbe ?? defaultClaudeVersionProbe)({
    commandPath,
    env,
    timeoutMs: opts.versionTimeoutMs ?? DEFAULT_CLAUDE_VERSION_TIMEOUT_MS,
  });

  if (!version) {
    return {
      name: "claude-binary",
      status: "warn",
      message: `Claude binary found: ${commandPath}, but version could not be read`,
      hint: "Run `claude --version` directly to verify the installed Claude Code binary.",
    };
  }

  return {
    name: "claude-binary",
    status: "pass",
    message: `Claude binary found: ${commandPath} (${version})`,
  };
}

/**
 * Checks whether a daemon can be reached and can answer `daemon.status`.
 */
export async function checkDaemonReachability(
  opts: CheckDaemonReachabilityOptions = {}
): Promise<DoctorCheck> {
  const env = opts.env ?? process.env;

  if (env.MYCLAUDE_FORCE_STANDALONE === "1") {
    return {
      name: "daemon",
      status: "warn",
      message: "Daemon check skipped: MYCLAUDE_FORCE_STANDALONE=1",
      hint: "Unset MYCLAUDE_FORCE_STANDALONE to let doctor probe the daemon.",
    };
  }

  try {
    const probeInput: DaemonStatusProbeInput = {
      attemptTimeoutMs: opts.attemptTimeoutMs ?? DEFAULT_DAEMON_ATTEMPT_TIMEOUT_MS,
    };
    if (opts.home !== undefined) probeInput.home = opts.home;
    const status = await (opts.statusProbe ?? defaultDaemonStatusProbe)(probeInput);
    return {
      name: "daemon",
      status: "pass",
      message: `Daemon reachable: pid ${status.pid}, socket ${status.socketPath}, sessions ${status.sessionCounts.active} active / ${status.sessionCounts.total} recent`,
    };
  } catch (err) {
    if (err instanceof CliError && err.exitCode === EXIT_DAEMON_UNREACHABLE) {
      return {
        name: "daemon",
        status: "warn",
        message: "Daemon unreachable; standalone fallback will be used where supported",
        hint: err.hint ?? "Start it with `myclaude daemon start`.",
      };
    }

    return {
      name: "daemon",
      status: "fail",
      message: `Daemon status probe failed: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Run `myclaude daemon status` for the daemon-specific error.",
    };
  }
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
  }
  process.stdout.write(`${prefix} ${check.message}\n`);
  if (check.hint && (check.status === "fail" || check.status === "warn")) {
    process.stdout.write(`    Fix: ${check.hint}\n`);
  }
}

/**
 * Runs all doctor checks and emits either human or JSON output.
 */
export async function runDoctor(opts: RunDoctorOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const keychainChecks = await checkKeychainBackend(opts.backend, env);
  const claudeBinaryOptions: CheckClaudeBinaryOptions = { env };
  if (opts.claudeVersionProbe !== undefined) {
    claudeBinaryOptions.versionProbe = opts.claudeVersionProbe;
  }
  const daemonOptions: CheckDaemonReachabilityOptions = { env };
  if (opts.home !== undefined) daemonOptions.home = opts.home;
  if (opts.daemonStatusProbe !== undefined) {
    daemonOptions.statusProbe = opts.daemonStatusProbe;
  }
  const checks: DoctorCheck[] = [
    checkNodeVersion(),
    ...checkVersions(),
    ...checkScopeFiles(opts.home, opts.cwd),
    ...keychainChecks,
    await checkClaudeBinary(claudeBinaryOptions),
    await checkDaemonReachability(daemonOptions),
  ];

  const hasFailures = checks.some((c) => c.status === "fail");

  if (opts.json || opts.pretty) {
    writeJson({ checks, healthy: !hasFailures }, Boolean(opts.pretty));
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
}

/**
 * `myclaude doctor` command definition.
 */
export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Environment diagnostics",
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
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
    cwd: {
      type: "string",
      description: "Override working directory (for testing)",
    },
  },
  async run({ args }) {
    const runOptions: RunDoctorOptions = {
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    };
    if (typeof args.home === "string") runOptions.home = args.home;
    if (typeof args.cwd === "string") runOptions.cwd = args.cwd;
    await runDoctor(runOptions);
  },
});

async function defaultClaudeVersionProbe(input: ClaudeVersionProbeInput): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(input.commandPath, ["--version"], {
      env: input.env,
      timeout: input.timeoutMs,
      windowsHide: true,
    });
    const output = [stdout, stderr]
      .map((chunk) => String(chunk).trim())
      .filter(Boolean)
      .join("\n");
    return output.split(/\r?\n/).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

async function defaultDaemonStatusProbe(
  input: DaemonStatusProbeInput
): Promise<TransportDaemonStatusResult> {
  const transportOptions: Parameters<typeof getTransport>[0] = { requireDaemon: true };
  if (input.home !== undefined) transportOptions.home = input.home;
  if (input.attemptTimeoutMs !== undefined)
    transportOptions.attemptTimeoutMs = input.attemptTimeoutMs;

  const transport = await getTransport(transportOptions);
  try {
    return await transport.daemonStatus();
  } finally {
    await transport.close();
  }
}

async function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const pathValue = env.PATH;
  if (!pathValue) return null;

  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }

  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

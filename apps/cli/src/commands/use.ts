/**
 * @module commands/use
 *
 * `myclaude use <role> [--auth <id>]`
 *
 * Writes project-local activation state into the nearest existing `.myclaude`
 * directory found by walking up from cwd. If no marker exists, creates
 * `<cwd>/.myclaude/`.
 */
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defineCommand } from "citty";
import { CliError, EXIT_GENERIC } from "../errors.js";

/** Options for `myclaude use`. */
export interface UseOptions {
  /** Role name to activate. */
  role: string;
  /** Optional auth profile ID to activate. */
  auth?: string;
  /** Working directory for find-up marker discovery. */
  cwd?: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findNearestMyClaudeDir(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    const marker = join(current, ".myclaude");
    if (isDirectory(marker)) return marker;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function atomicWriteText(filePath: string, value: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.${basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  try {
    writeFileSync(tmpPath, `${value}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw err;
  }
}

/**
 * Core logic for `myclaude use`.
 */
export function runUse(opts: UseOptions): void {
  const cwd = opts.cwd ?? process.cwd();
  const role = opts.role.trim();
  const auth = opts.auth?.trim();

  if (role.length === 0) {
    throw new CliError("Role is required.", EXIT_GENERIC);
  }
  if (auth !== undefined && auth.length === 0) {
    throw new CliError("Auth profile ID cannot be empty.", EXIT_GENERIC);
  }

  const myClaudeDir = findNearestMyClaudeDir(cwd) ?? join(resolve(cwd), ".myclaude");
  const rolePath = join(myClaudeDir, "role");
  atomicWriteText(rolePath, role);
  process.stdout.write(`Wrote ${rolePath} (${role})\n`);

  if (auth !== undefined) {
    const authPath = join(myClaudeDir, "auth");
    atomicWriteText(authPath, auth);
    process.stdout.write(`Wrote ${authPath} (${auth})\n`);
  }
}

/**
 * `myclaude use <role> [--auth <id>]` command definition.
 */
export const useCommand = defineCommand({
  meta: {
    name: "use",
    description: "Write project-local activation state",
  },
  args: {
    role: {
      type: "positional",
      description: "Role name",
      required: true,
    },
    auth: {
      type: "string",
      description: "Auth profile ID",
      alias: "a",
    },
    cwd: {
      type: "string",
      description: "Override working directory (for testing)",
    },
  },
  run({ args }) {
    runUse({
      role: args.role,
      auth: args.auth,
      cwd: args.cwd,
    });
  },
});

/**
 * @module commands/unuse
 *
 * `myclaude unuse`
 *
 * Removes project-local activation state. The target is the first find-up
 * `.myclaude` directory with activation files that are currently effective;
 * if none is active, the nearest existing `.myclaude` marker is used.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineCommand } from "citty";

/** Options for `myclaude unuse`. */
export interface UnuseOptions {
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

function readActivationFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8").trim();
  return content.length > 0 ? content : null;
}

function hasEffectiveActivation(myClaudeDir: string): boolean {
  return (
    readActivationFile(join(myClaudeDir, "role")) !== null ||
    readActivationFile(join(myClaudeDir, "auth")) !== null
  );
}

function findUnuseTarget(startDir: string): string | null {
  let current = resolve(startDir);
  let nearestMarker: string | null = null;

  while (true) {
    const marker = join(current, ".myclaude");
    if (isDirectory(marker)) {
      nearestMarker ??= marker;
      if (hasEffectiveActivation(marker)) return marker;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return nearestMarker;
}

/**
 * Core logic for `myclaude unuse`.
 */
export function runUnuse(opts: UnuseOptions = {}): void {
  const cwd = opts.cwd ?? process.cwd();
  const myClaudeDir = findUnuseTarget(cwd) ?? join(resolve(cwd), ".myclaude");
  const activationFiles = [join(myClaudeDir, "role"), join(myClaudeDir, "auth")];
  const removedFiles: string[] = [];

  for (const filePath of activationFiles) {
    if (existsSync(filePath)) removedFiles.push(filePath);
    rmSync(filePath, { force: true });
  }

  if (removedFiles.length === 0) {
    process.stdout.write("No activation files found.\n");
    return;
  }

  for (const filePath of removedFiles) {
    process.stdout.write(`Removed ${filePath}\n`);
  }
}

/**
 * `myclaude unuse` command definition.
 */
export const unuseCommand = defineCommand({
  meta: {
    name: "unuse",
    description: "Remove project-local activation state",
  },
  args: {
    cwd: {
      type: "string",
      description: "Override working directory (for testing)",
    },
  },
  run({ args }) {
    runUnuse({ cwd: args.cwd });
  },
});

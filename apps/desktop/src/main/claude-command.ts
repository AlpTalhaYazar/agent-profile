import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ResolveClaudeCommandInput {
  env?: NodeJS.ProcessEnv;
  override?: string;
}

export async function resolveClaudeCommand(input: ResolveClaudeCommandInput = {}): Promise<string> {
  const env = input.env ?? process.env;
  const override = input.override ?? env.MYCLAUDE_CLAUDE_COMMAND;

  if (override) {
    return assertExecutable(override, "Configured Claude command is not executable");
  }

  const fromPath = await findOnPath("claude", env.PATH);
  if (fromPath) return fromPath;

  const fromLoginShell = await resolveFromLoginShell(env);
  if (fromLoginShell) return fromLoginShell;

  for (const candidate of knownClaudePaths(env)) {
    if (await isExecutable(candidate)) return candidate;
  }

  throw new Error(
    [
      "Claude Code executable was not found.",
      "Install Claude Code or set MYCLAUDE_CLAUDE_COMMAND to the absolute claude binary path.",
      "Checked PATH, login shell, ~/.local/bin/claude, /opt/homebrew/bin/claude, and /usr/local/bin/claude.",
    ].join(" ")
  );
}

async function resolveFromLoginShell(env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", "command -v claude"], {
      env,
      timeout: 5_000,
    });
    const command = stdout.trim().split(/\r?\n/).find(Boolean);
    if (!command) return null;
    return (await isExecutable(command)) ? command : null;
  } catch {
    return null;
  }
}

async function findOnPath(command: string, pathValue: string | undefined): Promise<string | null> {
  if (!pathValue) return null;
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function knownClaudePaths(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME || homedir();
  return [
    join(home, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

async function assertExecutable(path: string, message: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new Error(`${message}: expected an absolute path, got "${path}".`);
  }
  if (await isExecutable(path)) return path;
  throw new Error(`${message}: "${path}".`);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

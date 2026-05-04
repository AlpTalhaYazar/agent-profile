import { homedir } from "node:os";
import { join } from "node:path";

export const SERVER_VERSION = "0.1.0";
export const STARTUP_CWD = process.cwd();

export function isHeadless(argv: string[] = process.argv, env = process.env): boolean {
  if (env.MYCLAUDE_HEADLESS === "1") return true;
  return argv.includes("--headless");
}

export function isTestEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test" || env.VITEST === "true";
}

export function resolveMyClaudeHome(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  return env.MYCLAUDE_HOME ?? join(home, ".myclaude");
}

/**
 * @module utils/paths
 *
 * Path utilities for locating `~/.myclaude` and project-level `.myclaude` dirs.
 * Respects `MYCLAUDE_HOME` env override (used in tests and advanced setups).
 */
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Returns the root of the user's myclaude home directory.
 *
 * Resolution order:
 * 1. `MYCLAUDE_HOME` environment variable (useful for tests and custom installs).
 * 2. `~/.myclaude`.
 *
 * @returns Absolute path to the myclaude home directory.
 */
export function myClaudeHome(): string {
  return process.env.MYCLAUDE_HOME ?? join(homedir(), ".myclaude");
}

/**
 * Returns the global config directory: `<myClaudeHome>/config`.
 */
export function globalConfigDir(home?: string): string {
  return join(home ?? myClaudeHome(), "config");
}

/**
 * Returns the path to the global shared scope file.
 */
export function globalSharedPath(home?: string): string {
  return join(globalConfigDir(home), "global", "shared.yml");
}

/**
 * Returns the path to a global role scope file.
 *
 * @param role - Role name (e.g. `"backend"`).
 */
export function globalRolePath(role: string, home?: string): string {
  return join(globalConfigDir(home), "global", "roles", `${role}.yml`);
}

/**
 * Returns the path to the global fragments directory.
 */
export function globalFragmentsDir(home?: string): string {
  return join(globalConfigDir(home), "fragments");
}

/**
 * Returns the path to the global roles directory.
 */
export function globalRolesDir(home?: string): string {
  return join(globalConfigDir(home), "global", "roles");
}

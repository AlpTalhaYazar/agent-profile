/**
 * @module paths
 *
 * Pure path helpers for the agent-profile data layout.
 *
 * Services in this package never call `os.homedir()` or read `process.env`
 * implicitly — every path is derived from inputs the caller supplies. These
 * helpers make it easy for both the CLI (which knows the user's home and
 * `MYCLAUDE_HOME` override) and the daemon (which receives `home` over IPC,
 * or runs against a per-test sandbox) to compute the canonical paths the
 * same way.
 */
import { join } from "node:path";

/**
 * Returns the global config directory for a given home.
 *
 * @param home - Absolute path to the myclaude home directory
 *   (e.g. `/Users/alice/.myclaude`).
 * @returns `<home>/config`.
 */
export function globalConfigDirFor(home: string): string {
  return join(home, "config");
}

/**
 * Returns the global fragments directory for a given home.
 *
 * @param home - Absolute path to the myclaude home directory.
 * @returns `<home>/config/fragments`.
 */
export function globalFragmentsDirFor(home: string): string {
  return join(home, "config", "fragments");
}

/**
 * Returns the canonical path of `authProfiles.yml` for a given home.
 *
 * @param home - Absolute path to the myclaude home directory.
 * @returns `<home>/config/authProfiles.yml`.
 */
export function authProfilesPathFor(home: string): string {
  return join(globalConfigDirFor(home), "authProfiles.yml");
}

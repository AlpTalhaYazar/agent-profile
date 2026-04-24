/**
 * @module auth/profiles-file
 *
 * Load and save `authProfiles.yml` atomically.
 *
 * The file lives at `<MYCLAUDE_HOME>/config/authProfiles.yml`.
 * Schema is `AuthProfilesDoc` from `@agent-profile/core`.
 *
 * Round-trip comment preservation is not guaranteed in v1 — replace-on-write
 * is used. TODO(future): use yaml `Document` API to preserve comments.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AuthProfilesDoc, type AuthProfilesDocT } from "@agent-profile/core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { CliError, EXIT_CONFIG_INVALID } from "../errors.js";
import { globalConfigDir } from "../utils/paths.js";

/**
 * Returns the path to `authProfiles.yml` for the given home directory.
 *
 * @param home - Override for the myclaude home directory.
 */
export function authProfilesPath(home?: string): string {
  return join(globalConfigDir(home), "authProfiles.yml");
}

/**
 * The empty/default auth profiles document.
 * Returned when the file does not exist.
 */
const EMPTY_DOC: AuthProfilesDocT = {
  version: 1,
  authProfiles: {},
};

/**
 * Loads and validates `authProfiles.yml`.
 *
 * If the file does not exist, returns the empty default.
 * If the file exists but fails schema validation, throws a `CliError` (exit 2).
 *
 * @param home - Override for the myclaude home directory.
 * @returns Parsed and validated `AuthProfilesDocT`.
 * @throws {CliError} If the file exists but cannot be parsed or validated.
 */
export function loadAuthProfiles(home?: string): AuthProfilesDocT {
  const filePath = authProfilesPath(home);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    // File not found — return empty default.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(EMPTY_DOC);
    }
    throw new CliError(
      `Failed to read authProfiles.yml: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_INVALID
    );
  }

  let parsed: unknown;
  try {
    parsed = yamlParse(raw);
  } catch (err) {
    throw new CliError(
      `Failed to parse authProfiles.yml: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_INVALID
    );
  }

  // Validate with Zod.
  const result = AuthProfilesDoc.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue ? issue.path.join(".") : "unknown";
    const msg = issue ? issue.message : "unknown error";
    throw new CliError(
      `Schema error in authProfiles.yml at "${path}": ${msg}`,
      EXIT_CONFIG_INVALID
    );
  }
  return result.data;
}

/**
 * Saves `authProfiles.yml` atomically using a temp file + rename.
 *
 * Ensures the parent directory exists. The file is written to a temp path
 * in the same directory and then renamed to prevent partial writes.
 *
 * @param doc - The `AuthProfilesDocT` document to write.
 * @param home - Override for the myclaude home directory.
 * @throws {CliError} If the write fails.
 */
export function saveAuthProfiles(doc: AuthProfilesDocT, home?: string): void {
  const filePath = authProfilesPath(home);
  const dir = dirname(filePath);

  // Ensure the config directory exists.
  mkdirSync(dir, { recursive: true });

  const content = yamlStringify(doc, { lineWidth: 0 });

  // Atomic write: write to temp file, then rename.
  const tmpPath = join(dir, `.authProfiles.yml.tmp.${process.pid}.${Date.now()}`);

  try {
    writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up the temp file if rename fails.
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw new CliError(
      `Failed to save authProfiles.yml: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_INVALID
    );
  }
}

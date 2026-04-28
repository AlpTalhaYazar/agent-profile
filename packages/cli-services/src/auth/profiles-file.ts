/**
 * @module auth/profiles-file
 *
 * Load and save `authProfiles.yml` atomically.
 *
 * The file lives at `<MYCLAUDE_HOME>/config/authProfiles.yml`. Schema is
 * `AuthProfilesDoc` from `@agent-profile/core`.
 *
 * This module was previously hosted at `apps/cli/src/auth/profiles-file.ts` and
 * lives here so the desktop daemon can reuse the exact same loader without
 * having to depend on `apps/cli`. The CLI keeps a one-line re-export shim so
 * existing imports (and the existing test contract — `exitCode: 2` on schema
 * errors, default empty doc on missing file) keep working unchanged.
 *
 * Round-trip comment preservation is not guaranteed — replace-on-write is used.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AuthProfilesDoc, type AuthProfilesDocT } from "@agent-profile/core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { ServiceError } from "../errors.js";
import { authProfilesPathFor } from "../paths.js";

/**
 * Resolve the myclaude home directory the legacy way, mirroring the CLI's
 * `myClaudeHome()` so re-exports preserve behaviour.
 *
 * Resolution order:
 * 1. The explicit `home` argument, if defined.
 * 2. `MYCLAUDE_HOME` env override.
 * 3. `~/.myclaude`.
 *
 * The desktop daemon does not call this helper directly — it always passes an
 * explicit `home` over IPC. This fallback exists strictly so the CLI's
 * `loadAuthProfiles()` re-export keeps its no-arg ergonomics for built-in
 * tooling and ad-hoc REPL usage.
 */
function resolveHome(home?: string): string {
  if (home !== undefined) return home;
  return process.env.MYCLAUDE_HOME ?? join(homedir(), ".myclaude");
}

/**
 * Returns the path to `authProfiles.yml` for the given home directory.
 *
 * @param home - Override for the myclaude home directory. Falls back to
 *   `MYCLAUDE_HOME` env, then `~/.myclaude`.
 */
export function authProfilesPath(home?: string): string {
  return authProfilesPathFor(resolveHome(home));
}

/** The empty/default auth profiles document — returned when the file is absent. */
const EMPTY_DOC: AuthProfilesDocT = {
  version: 1,
  authProfiles: {},
};

/**
 * Loads and validates `authProfiles.yml`.
 *
 * If the file does not exist, returns the empty default. If the file exists
 * but fails schema validation, throws a `ServiceError` with `code:
 * "config-invalid"` and `exitCode: 2` so the CLI's existing exit-code
 * contract is preserved.
 *
 * @param home - Override for the myclaude home directory.
 * @returns Parsed and validated `AuthProfilesDocT`.
 * @throws {ServiceError} `code: "config-invalid"` if the file exists but cannot
 *   be parsed or validated.
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
    throw new ServiceError(
      "config-invalid",
      `Failed to read authProfiles.yml: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  let parsed: unknown;
  try {
    parsed = yamlParse(raw);
  } catch (err) {
    throw new ServiceError(
      "config-invalid",
      `Failed to parse authProfiles.yml: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  const result = AuthProfilesDoc.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue ? issue.path.join(".") : "unknown";
    const msg = issue ? issue.message : "unknown error";
    throw new ServiceError(
      "config-invalid",
      `Schema error in authProfiles.yml at "${path}": ${msg}`
    );
  }
  return result.data;
}

/**
 * Saves `authProfiles.yml` atomically using a temp file + rename.
 *
 * Ensures the parent directory exists. The file is written to a temp path in
 * the same directory and then renamed to prevent partial writes.
 *
 * @param doc - The `AuthProfilesDocT` document to write.
 * @param home - Override for the myclaude home directory.
 * @throws {ServiceError} `code: "io-error"` if the write fails.
 */
export function saveAuthProfiles(doc: AuthProfilesDocT, home?: string): void {
  const filePath = authProfilesPath(home);
  const dir = dirname(filePath);

  mkdirSync(dir, { recursive: true });

  const content = yamlStringify(doc, { lineWidth: 0 });
  const tmpPath = join(dir, `.authProfiles.yml.tmp.${process.pid}.${Date.now()}`);

  try {
    writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw new ServiceError(
      "io-error",
      `Failed to save authProfiles.yml: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}

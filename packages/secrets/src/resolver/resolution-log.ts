/**
 * Resolution log builder for secret materialization.
 *
 * Log entries describe what happened during resolution — which refs were found,
 * how they were resolved, and whether they succeeded. They NEVER contain
 * the resolved secret value. This is enforced both by the type (no `value` field)
 * and by tests that serialize the log and scan for known test secrets.
 */

/**
 * Source classification for how a ref was resolved.
 *
 * - `keyring` — resolved directly from `keyring://svc/acct`
 * - `env` — resolved from `process.env.VAR` (or injected env map)
 * - `secret-via-authprofile` — resolved from `${secret:name}` via `authProfile.mcpSecretRefs`,
 *   which mapped to a keyring URI
 */
export type ResolutionSource = "keyring" | "env" | "secret-via-authprofile";

/**
 * A single entry in the resolution log.
 *
 * NOTE: This type intentionally has no `value` field. Secret values must
 * never appear in logs. Tests assert this at both the type level and runtime.
 */
export interface ResolutionLogEntry {
  /** JSON-path of the config field where the ref was found. */
  readonly path: string;
  /** The kind of ref (`"keyring"`, `"secret"`, `"env"`). */
  readonly refKind: "keyring" | "secret" | "env";
  /**
   * The ref identifier (URI, name, or env var name) — not the resolved value.
   * For keyring: `"agent-profile.svc.acct"`; for secret: `"name"`; for env: `"VAR"`.
   */
  readonly refIdentifier: string;
  /** How the ref was ultimately resolved. */
  readonly source: ResolutionSource;
  /** Whether the ref was successfully resolved. */
  readonly resolved: boolean;
  /** ISO-8601 timestamp of this resolution event. */
  readonly timestamp: string;
}

/**
 * Creates a new resolution log entry.
 *
 * @param path - JSON-path of the config field.
 * @param refKind - The ref type.
 * @param refIdentifier - The ref identifier (never the value).
 * @param source - How the ref was resolved.
 * @param resolved - Whether the resolution succeeded.
 */
export function makeLogEntry(
  path: string,
  refKind: ResolutionLogEntry["refKind"],
  refIdentifier: string,
  source: ResolutionSource,
  resolved: boolean
): ResolutionLogEntry {
  return {
    path,
    refKind,
    refIdentifier,
    source,
    resolved,
    timestamp: new Date().toISOString(),
  };
}

/**
 * @module sessions/drift
 *
 * Drift detection service for `sessions.drift`.
 *
 * Re-resolves the cascade for a recorded session and compares the freshly
 * computed launch hash against the one captured at `session.start`. The
 * service is read-only and works in-process, so it is the single
 * non-daemon-only addition to the Session Monitor surface.
 *
 * `scopesChanged` is best-effort: the launch-time provenance is not
 * persisted alongside the session record (only the hash is), so we cannot
 * diff scope file contents directly. When the hash drifted we surface the
 * current set of scope files as the "changed" list — callers can use this
 * as a starting point for a more detailed diff. When `drifted` is `false`
 * the list is empty.
 */
import type { EffectiveSessionConfig } from "@agent-profile/core";
import { ServiceError } from "../errors.js";
import { computeLaunchHash } from "../launch-hash.js";
import { profileShowService } from "../profile/show.js";
import { type SessionRecord, readSessionRecord } from "./registry.js";

/**
 * Optional override for the `profileShowService` lookup. Tests pass a stub
 * that returns a deterministic `EffectiveSessionConfig` without touching
 * disk.
 */
export type GetEffectiveFn = (input: {
  role: string;
  authProfileId: string;
  cwd: string;
  home: string;
}) => EffectiveSessionConfig;

/** Input options for `driftService`. */
export interface DriftServiceInput {
  /** Absolute path to the configured sessions root (e.g. `~/.myclaude/sessions`). */
  sessionsRoot: string;
  /** Session id whose launch hash should be re-checked. */
  sessionId: string;
  /** Absolute path to the myclaude home directory (cookie + config). */
  home: string;
  /**
   * Optional injection point for tests. When omitted, the service calls
   * {@link profileShowService} with the session's recorded
   * `(role, authProfileId, cwd)`.
   */
  getEffective?: GetEffectiveFn;
}

/** Result returned by {@link driftService}. */
export interface DriftServiceResult {
  /** True when the recomputed hash differs from the launch-time hash. */
  drifted: boolean;
  /**
   * Best-effort list of scope file paths considered relevant. When `drifted`
   * is `false` this is `[]`; otherwise it is the current set of scope files
   * extracted from the freshly resolved provenance. Callers wanting a
   * content-level diff need to recompute against the launch-time provenance
   * (which is not persisted).
   */
  scopesChanged: string[];
  /** The launch-time hash recorded on the session. */
  oldHash: string;
  /** The freshly computed hash. */
  newHash: string;
}

/**
 * Recompute the launch hash for a session and compare against the one
 * captured at launch time.
 *
 * @throws {ServiceError} `code: "not-found"` when the record file is missing.
 * @throws {ServiceError} `code: "config-invalid"` when the record exists but
 *   has no `launchHash` recorded — drift detection requires the daemon to have
 *   stamped the launch hash at `session.start`.
 */
export async function driftService(input: DriftServiceInput): Promise<DriftServiceResult> {
  const record = await readSessionRecord({
    sessionsRoot: input.sessionsRoot,
    sessionId: input.sessionId,
  });

  // ST-2 will add the optional `launchHash` field to SessionRecord. Guard
  // against both presence (post-ST-2) and absence (pre-ST-2 records) here.
  const launchHash = readLaunchHash(record);
  if (launchHash === undefined) {
    throw new ServiceError(
      "config-invalid",
      `Session "${input.sessionId}" has no launch hash; drift detection unavailable.`
    );
  }

  const getEffective = input.getEffective ?? defaultGetEffective;
  const resolved = getEffective({
    role: record.role,
    authProfileId: record.authProfileId,
    cwd: record.cwd,
    home: input.home,
  });

  const scopeFiles = extractScopeFiles(resolved.provenance);
  const newHash = computeLaunchHash({
    effective: resolved.effective,
    provenance: resolved.provenance,
    scopeFiles,
  });

  const drifted = newHash !== launchHash;
  return {
    drifted,
    scopesChanged: drifted ? scopeFiles : [],
    oldHash: launchHash,
    newHash,
  };
}

/**
 * Read the optional `launchHash` field off a `SessionRecord`.
 *
 * `launchHash` is optional on the schema (it lands at `session.start` time,
 * and pre-Phase-2-milestone-5 records do not carry one). Treat empty
 * strings as absent.
 */
function readLaunchHash(record: SessionRecord): string | undefined {
  const value = record.launchHash;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Extract a flat list of scope file paths from a provenance value.
 *
 * `Provenance` does not carry a top-level `scopeFiles` field today; the
 * closest available signal is `provenance.persona[].files`. We dedupe,
 * preserve insertion order, and gracefully handle unexpected shapes (this
 * function runs against `unknown`, since the wire schema does not narrow
 * the provenance shape downstream of the CLI services boundary).
 */
function extractScopeFiles(provenance: unknown): string[] {
  if (provenance === null || typeof provenance !== "object") return [];
  const obj = provenance as Record<string, unknown>;

  // Prefer an explicit `scopeFiles` array if a future provenance shape adds
  // one. This keeps the helper forward-compatible without coupling to the
  // current Provenance type.
  if (Array.isArray(obj.scopeFiles)) {
    const direct = obj.scopeFiles.filter((entry): entry is string => typeof entry === "string");
    return Array.from(new Set(direct));
  }

  // Fallback: derive from `persona[].files`. Approximation — this misses
  // scope files that contribute env/settings/mcp without persona content.
  // The hash itself is still authoritative; this list is informational.
  const persona = obj.persona;
  if (!Array.isArray(persona)) return [];
  const files: string[] = [];
  const seen = new Set<string>();
  for (const entry of persona) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = (entry as Record<string, unknown>).files;
    if (!Array.isArray(candidate)) continue;
    for (const file of candidate) {
      if (typeof file !== "string" || seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

function defaultGetEffective(input: {
  role: string;
  authProfileId: string;
  cwd: string;
  home: string;
}): EffectiveSessionConfig {
  return profileShowService({
    role: input.role,
    authProfileId: input.authProfileId,
    cwd: input.cwd,
    home: input.home,
  });
}

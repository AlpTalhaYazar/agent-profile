/**
 * @module @agent-profile/ipc-protocol/handshake
 *
 * Pure handshake-policy helpers shared by the client and server.
 *
 * Two checks live here:
 *
 *  - {@link negotiateVersion} — semver-major equality. Only the leading
 *    integer is compared. Mismatches return a structured discriminated result;
 *    the server translates that into an `error.AUTH_VERSION` response.
 *  - {@link validateCookie} — constant-time comparison of the boot cookie the
 *    client read from `~/.myclaude/ipc-cookie` against the value the server
 *    holds in memory. Constant-time comparison defeats timing-based brute force
 *    of partial cookie matches.
 *
 * This module is intentionally pure (no I/O, no Node sockets) so it can be
 * unit-tested without spinning up a server.
 */

import { timingSafeEqualString } from "@agent-profile/capability";

/** Successful version negotiation. */
export interface VersionOk {
  ok: true;
}

/** Failed version negotiation; only one reason is currently emitted. */
export interface VersionFail {
  ok: false;
  reason: "incompatible-major";
}

/** Discriminated result of {@link negotiateVersion}. */
export type VersionResult = VersionOk | VersionFail;

/**
 * Compare semver major versions for handshake compatibility.
 *
 * Both versions are parsed as `<integer>(.anything)?`. Only the leading integer
 * matters; minor and patch differences are tolerated under semver rules. A
 * non-numeric prefix (e.g. an empty string) is treated as `NaN` and fails as
 * `incompatible-major`.
 *
 * @param clientVersion - The version string the client sent in `hello`.
 * @param serverVersion - The version string the daemon advertises.
 * @returns `{ ok: true }` when majors match, otherwise a `{ ok: false, reason }`.
 */
export function negotiateVersion(clientVersion: string, serverVersion: string): VersionResult {
  const clientMajor = parseMajor(clientVersion);
  const serverMajor = parseMajor(serverVersion);
  if (clientMajor === null || serverMajor === null) {
    return { ok: false, reason: "incompatible-major" };
  }
  if (clientMajor !== serverMajor) {
    return { ok: false, reason: "incompatible-major" };
  }
  return { ok: true };
}

/**
 * Constant-time cookie comparison.
 *
 * Delegates to `timingSafeEqualString` from `@agent-profile/capability`, which
 * hashes both inputs with SHA-256 and compares fixed-size digests. This defeats
 * length-leaks an attacker could otherwise observe from a direct length check.
 *
 * @param presented - The cookie the client sent in `hello`.
 * @param expected - The cookie the daemon generated at boot.
 * @returns `true` iff the two strings are byte-equal, `false` otherwise.
 */
export function validateCookie(presented: string, expected: string): boolean {
  return timingSafeEqualString(presented, expected);
}

/**
 * Parse the leading integer of a semver-ish string.
 *
 * Returns `null` if the string is empty or its leading characters do not form
 * a valid integer. We do not require strict semver; pre-release tags (`-rc1`)
 * and build metadata (`+abcd`) are ignored as long as a leading integer exists.
 */
function parseMajor(version: string): number | null {
  const match = version.match(/^(\d+)/);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

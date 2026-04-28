/**
 * @module @agent-profile/capability/compare
 *
 * Constant-time string comparison for capability tokens.
 *
 * A capability token proves that the caller holds the per-session secret value
 * baked into the session manifest. Comparing it against the stored token must
 * not leak timing information about either the length of the expected token or
 * the position of the first differing byte.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare two strings in constant time relative to their contents and lengths.
 *
 * The inputs are hashed with SHA-256 first and the fixed-size digests are
 * compared with `crypto.timingSafeEqual`. Hashing before compare defeats the
 * length-leak an attacker could otherwise observe from a direct length check
 * or from `timingSafeEqual`'s own length-mismatch short-circuit.
 *
 * @param a - First string (e.g. the token from the session manifest).
 * @param b - Second string (e.g. the token supplied by the caller).
 * @returns `true` iff the two strings are byte-equal, `false` otherwise.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  // Hash-then-compare defeats the length-leak inherent in raw length checks.
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Path-safety helpers for `@agent-profile/persona-deployer`.
 *
 * These functions protect `cleanupSession` from deleting arbitrary paths.
 * All deletion paths must pass through `assertInsideRoot` before any `rm`
 * operation is performed.
 */

import { isAbsolute, relative, resolve } from "node:path";
import { SessionPathUnsafeError } from "./errors.js";

/**
 * Returns `true` if `p` is strictly inside `root` (i.e. `p === root` or
 * `p` is a descendant of `root`).
 *
 * Both paths are `resolve()`d before comparison to normalise `..` segments
 * and redundant separators.
 *
 * @param p    - The candidate path to test.
 * @param root - The root directory to check against.
 *
 * @example
 * isPathWithinRoot('/a/b/c', '/a/b')  // true
 * isPathWithinRoot('/a/b', '/a/b/c')  // false
 * isPathWithinRoot('/a/b/../c', '/a') // true — '/a/c' is inside '/a'
 * isPathWithinRoot('/x', '/y')        // false
 */
export function isPathWithinRoot(p: string, root: string): boolean {
  const resolvedP = resolve(p);
  const resolvedRoot = resolve(root);

  const rel = relative(resolvedRoot, resolvedP);

  // `relative` returns an empty string when paths are equal.
  // It returns a path starting with `..` when `p` escapes `root`.
  // It returns an absolute path only when roots are on different drives (Windows).
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Asserts that `p` is within at least one of the provided `allowedRoots`.
 *
 * Throws `SessionPathUnsafeError` if the path is outside every allowed root.
 * This is the single choke-point that all deletion code must go through.
 *
 * @param p            - The path to validate.
 * @param allowedRoots - Array of root directories the path must be inside.
 *
 * @throws {SessionPathUnsafeError} When `p` is not inside any allowed root.
 */
export function assertInsideRoot(p: string, allowedRoots: readonly string[]): void {
  const safe = allowedRoots.some((root) => isPathWithinRoot(p, root));
  if (!safe) {
    throw new SessionPathUnsafeError(p, allowedRoots);
  }
}

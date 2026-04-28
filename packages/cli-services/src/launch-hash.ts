/**
 * @module launch-hash
 *
 * Stable hash of a launch-time effective config snapshot.
 *
 * The Session Monitor's drift detector compares the hash captured at
 * `session.start` time against a freshly recomputed one from
 * `profile.show`. A divergence means a scope file changed under the
 * running session and the user should consider relaunching.
 *
 * Both the daemon (when stamping `SessionRecord.launchHash` on launch) and
 * the standalone CLI drift command import this helper so the digest is
 * portable across transports.
 */

import { createHash } from "node:crypto";

/**
 * Inputs that materially shape the effective config of a launched session.
 *
 * `effective` and `provenance` come from `profileShowService`. `scopeFiles`
 * is the list of scope file paths that contributed (sourced from
 * `provenance.scopeFiles` or equivalent); we hash the names plus their
 * absolute order so a drift driven by file removal/addition surfaces even
 * when the merged config happens to equal the prior one.
 */
export interface LaunchHashInput {
  effective: unknown;
  provenance: unknown;
  scopeFiles: readonly string[];
}

/**
 * Compute the launch-time hash of the inputs.
 *
 * Returns the lowercase hex SHA-256 digest. Stable under re-ordering of
 * object keys (we sort keys before stringify), but **NOT** stable under
 * meaningful differences (different scope file ordering, different values,
 * etc.). Intended to be deterministic across runs of the same launch.
 */
export function computeLaunchHash(input: LaunchHashInput): string {
  const canonical = stableStringify({
    effective: input.effective,
    provenance: input.provenance,
    scopeFiles: [...input.scopeFiles],
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Deterministic JSON stringify with sorted object keys.
 *
 * Recurses through plain objects and arrays only. Functions, symbols, and
 * `undefined` are dropped (matching `JSON.stringify` semantics). The output
 * is suitable for hashing where structural equality must match across
 * processes regardless of key insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item));
    return `[${items.join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(",")}}`;
}

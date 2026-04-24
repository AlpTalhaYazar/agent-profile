/**
 * String substitution for secret references.
 *
 * Handles all three ref forms embedded in arbitrary strings:
 * - `keyring://svc/acct` — only when the entire string is the URI
 * - `${secret:name}` — inline or whole-value
 * - `${env:VAR}` — inline or whole-value
 *
 * When a ref is missing (resolver returns `null`), the original ref text is
 * preserved in the output so callers can detect and report missing refs.
 */

import type { SecretRef } from "@agent-profile/core";

/**
 * Regex for finding all embedded `${secret:name}` and `${env:VAR}` refs
 * in a string. Also matches the full `keyring://...` URI form.
 */
const EMBEDDED_REF_RE = /keyring:\/\/[^\s"']+|\$\{secret:[^}]+\}|\$\{env:[^}]+\}/g;

/**
 * Resolver callback type. Returns the resolved string value, or `null`
 * if the ref could not be resolved.
 */
export type RefResolver = (ref: SecretRef) => Promise<string | null>;

/**
 * Result of a single substitution pass over a string.
 */
export interface SubstituteResult {
  /** The string after substitution (missing refs left as-is). */
  value: string;
  /** Refs that could not be resolved (returned null). */
  missing: SecretRef[];
}

/**
 * Substitutes all secret references in a source string.
 *
 * Each detected ref token is passed to `resolver`. If `resolver` returns
 * `null`, the original ref text is preserved verbatim in the output and
 * the ref is added to `missing`.
 *
 * Batching (deduplicated backend reads) is the caller's responsibility;
 * the same resolver may be called multiple times for the same ref if it
 * appears multiple times in the string.
 *
 * @param source - The raw string that may contain ref tokens.
 * @param resolver - Async callback that resolves a single `SecretRef`.
 * @returns Substituted string and list of unresolved refs.
 */
export async function substitute(source: string, resolver: RefResolver): Promise<SubstituteResult> {
  // Collect all matches first to deduplicate calls for the same token.
  const tokens = new Set<string>();
  for (const match of source.matchAll(EMBEDDED_REF_RE)) {
    tokens.add(match[0]);
  }

  // Resolve all unique tokens in parallel.
  const resolvedMap = new Map<string, string | null>();
  await Promise.all(
    Array.from(tokens).map(async (token) => {
      const ref = tokenToRef(token);
      if (!ref) {
        // Unrecognized token — leave as-is (should not happen given the regex).
        resolvedMap.set(token, null);
        return;
      }
      const value = await resolver(ref);
      resolvedMap.set(token, value);
    })
  );

  // Substitute all occurrences in the source string.
  const missing: SecretRef[] = [];
  const result = source.replace(EMBEDDED_REF_RE, (token) => {
    const resolved = resolvedMap.get(token);
    if (resolved === null || resolved === undefined) {
      const ref = tokenToRef(token);
      if (ref) missing.push(ref);
      return token; // preserve original ref text
    }
    return resolved;
  });

  return { value: result, missing };
}

/**
 * Converts a matched ref token string into a `SecretRef` object.
 *
 * @param token - A raw ref token matched by `EMBEDDED_REF_RE`.
 * @returns A parsed `SecretRef`, or `null` if the token is unrecognized.
 */
function tokenToRef(token: string): SecretRef | null {
  // keyring:// URI
  const keyringMatch = /^keyring:\/\/([^/]+)\/(.+)$/.exec(token);
  if (keyringMatch) {
    const service = keyringMatch[1];
    const account = keyringMatch[2];
    if (service && account) {
      return { kind: "keyring", service, account, raw: token };
    }
  }

  // ${secret:name}
  const secretMatch = /^\$\{secret:([^}]+)\}$/.exec(token);
  if (secretMatch) {
    const name = secretMatch[1];
    if (name) {
      return { kind: "secret", name, raw: token };
    }
  }

  // ${env:VAR}
  const envMatch = /^\$\{env:([^}]+)\}$/.exec(token);
  if (envMatch) {
    const name = envMatch[1];
    if (name) {
      return { kind: "env", name, raw: token };
    }
  }

  return null;
}

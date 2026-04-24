/**
 * @module resolve/headers
 *
 * Pure resolver for MCP header secret references.
 *
 * Given a declarative header map (e.g. `{ Authorization: "Bearer ${secret:gh}" }`)
 * plus the active auth profile's `mcpSecretRefs` index, expand each reference
 * to its concrete value. Supported reference forms, all of which may appear
 * embedded in a larger string:
 *
 *  - `keyring://<service>/<account>` — direct keychain lookup.
 *  - `${secret:<name>}` — indirect keychain lookup via `mcpSecretRefs[name]`.
 *  - `${env:<VAR>}` — environment variable lookup.
 *
 * Keychain reads are batched: we collect the unique set of
 * `(service, account)` pairs from every referenced ref, issue one
 * `backend.get` per unique key in parallel, then substitute. This matches the
 * two-pass strategy used by `@agent-profile/secrets` to minimise macOS
 * keychain prompts.
 *
 * The resolver never mutates the input map and never returns a partially
 * resolved string: if any reference cannot be materialised it throws
 * `HelperError` with `EXIT_AUTH`, using only the reference identifier (never
 * a resolved value) in the message.
 */

import { type Backend, parseKeyringUri, toKeyringKey } from "@agent-profile/secrets";
import { EXIT_AUTH, HelperError } from "../errors.js";

/** Regex matching any supported embedded ref token. Mirrors resolve-secrets.ts. */
const EMBEDDED_RE = /keyring:\/\/[^\s"']+|\$\{secret:[^}]+\}|\$\{env:[^}]+\}/g;

/**
 * Options for `resolveHeaders`.
 */
export interface ResolveHeadersOptions {
  /** The raw header map as declared in the session manifest. */
  headers: Record<string, string>;
  /** `mcpSecretRefs` map from the session manifest's active auth profile. */
  mcpSecretRefs: Record<string, string>;
  /** Injected backend. Callers always pass one; no auto-detect here. */
  backend: Backend;
  /** Injected env map. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Resolve every secret reference in `headers` to its concrete value.
 *
 * @param opts - Resolution inputs.
 * @returns A new header map with all refs expanded. The input is not mutated.
 * @throws {HelperError} `EXIT_AUTH` when any referenced value cannot be
 *   resolved. The error message echoes the ref identifier (e.g.
 *   `${secret:github.pat}`) — never a resolved value.
 */
export async function resolveHeaders(opts: ResolveHeadersOptions): Promise<Record<string, string>> {
  const { headers, mcpSecretRefs, backend } = opts;
  const env = opts.env ?? process.env;

  // ── Pass 1: collect unique keychain keys referenced by any header value. ──
  const keychainCache = new Map<string, string | null>();

  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(EMBEDDED_RE)) {
      const token = match[0];

      if (token.startsWith("keyring://")) {
        // Defer parse errors to substitution so the failing ref identifier is
        // reported precisely (including invalid URI shape).
        try {
          const { service, account } = parseKeyringUri(token);
          const key = toKeyringKey(service, account);
          if (!keychainCache.has(key)) keychainCache.set(key, null);
        } catch {
          // Skip here; surfaces as an unresolved-ref error below.
        }
        continue;
      }

      const secretM = /^\$\{secret:([^}]+)\}$/.exec(token);
      if (secretM?.[1]) {
        const uri = mcpSecretRefs[secretM[1]];
        if (uri) {
          try {
            const { service, account } = parseKeyringUri(uri);
            const key = toKeyringKey(service, account);
            if (!keychainCache.has(key)) keychainCache.set(key, null);
          } catch {
            // Skip; surfaces below as an unresolved ref.
          }
        }
      }
      // env refs need no keychain batching.
    }
  }

  // ── Pass 2: batch-read every unique keychain key in parallel. ──
  await Promise.all(
    Array.from(keychainCache.keys()).map(async (key) => {
      keychainCache.set(key, await backend.get(key));
    })
  );

  // ── Pass 3: substitute each header value. Throws on any unresolved ref. ──
  const resolved: Record<string, string> = {};
  for (const [headerName, raw] of Object.entries(headers)) {
    resolved[headerName] = substitute(raw, mcpSecretRefs, keychainCache, env);
  }
  return resolved;
}

/**
 * Substitute every ref token in `value`.
 *
 * Throws `HelperError` with the ref identifier if any token cannot be
 * resolved. Never echoes resolved secret material.
 */
function substitute(
  value: string,
  mcpSecretRefs: Record<string, string>,
  keychainCache: Map<string, string | null>,
  env: Record<string, string | undefined>
): string {
  return value.replace(EMBEDDED_RE, (token) => {
    if (token.startsWith("keyring://")) {
      let service: string;
      let account: string;
      try {
        ({ service, account } = parseKeyringUri(token));
      } catch {
        throw unresolved(token);
      }
      const key = toKeyringKey(service, account);
      const cached = keychainCache.get(key);
      if (cached == null) throw unresolved(token);
      return cached;
    }

    const secretM = /^\$\{secret:([^}]+)\}$/.exec(token);
    if (secretM?.[1]) {
      const name = secretM[1];
      const uri = mcpSecretRefs[name];
      if (!uri) throw unresolved(token);
      let service: string;
      let account: string;
      try {
        ({ service, account } = parseKeyringUri(uri));
      } catch {
        throw unresolved(token);
      }
      const key = toKeyringKey(service, account);
      const cached = keychainCache.get(key);
      if (cached == null) throw unresolved(token);
      return cached;
    }

    const envM = /^\$\{env:([^}]+)\}$/.exec(token);
    if (envM?.[1]) {
      const v = env[envM[1]];
      if (v == null) throw unresolved(token);
      return v;
    }

    // Unknown token shape — treat as unresolved for safety.
    throw unresolved(token);
  });
}

/** Build the standard unresolved-ref `HelperError`. */
function unresolved(identifier: string): HelperError {
  return new HelperError(`unresolved secret reference: ${identifier}`, EXIT_AUTH);
}

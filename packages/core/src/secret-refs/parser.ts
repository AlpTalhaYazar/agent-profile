import type { McpServerT, ScopeDocT } from "../schema/index.js";

/**
 * A parsed secret reference.
 *
 * Three forms are supported:
 * - `keyring://service/account` — OS keychain via Main
 * - `${secret:name}` — from `authProfiles[id].mcpSecretRefs[name]`
 * - `${env:VAR}` — from `process.env.VAR` at resolve time
 */
export type SecretRef =
  | {
      kind: "keyring";
      service: string;
      account: string;
      /** The original raw string. */
      raw: string;
    }
  | {
      kind: "secret";
      name: string;
      /** The original raw string. */
      raw: string;
    }
  | {
      kind: "env";
      name: string;
      /** The original raw string. */
      raw: string;
    };

/**
 * A located secret reference — a parsed ref with its JSON path in the document.
 */
export interface LocatedSecretRef {
  ref: SecretRef;
  /** JSON path of the field containing this ref (e.g. `mcpServers.postgres.env.DATABASE_URL`). */
  jsonPath: string;
}

// Regexes for full-string matching of the three ref forms.
const KEYRING_RE = /^keyring:\/\/([^/]+)\/(.+)$/;
const SECRET_RE = /^\$\{secret:([^}]+)\}$/;
const ENV_RE = /^\$\{env:([^}]+)\}$/;

// Regexes for detecting refs embedded within a larger string.
const SECRET_EMBEDDED_RE = /\$\{secret:([^}]+)\}/;
const ENV_EMBEDDED_RE = /\$\{env:([^}]+)\}/;

/**
 * Parses a single string value as a secret reference.
 *
 * This function performs **exact matching** — the entire string must be a ref.
 * For detecting refs embedded in a larger string (e.g. `"${env:PWD}/src"`),
 * use `extractSecretRefs()` which calls `containsSecretRef()` internally.
 *
 * @param value - The string to parse.
 * @returns A `SecretRef` if the string is exactly a ref, or `null` otherwise.
 */
export function parseSecretRef(value: string): SecretRef | null {
  const keyringMatch = KEYRING_RE.exec(value);
  if (keyringMatch) {
    const service = keyringMatch[1];
    const account = keyringMatch[2];
    if (!service || !account) return null;
    return { kind: "keyring", service, account, raw: value };
  }

  const secretMatch = SECRET_RE.exec(value);
  if (secretMatch) {
    const name = secretMatch[1];
    if (!name) return null;
    return { kind: "secret", name, raw: value };
  }

  const envMatch = ENV_RE.exec(value);
  if (envMatch) {
    const name = envMatch[1];
    if (!name) return null;
    return { kind: "env", name, raw: value };
  }

  return null;
}

/**
 * Detects whether a string value contains any secret reference,
 * including refs embedded within larger strings (e.g. `"${env:PWD}/src"`).
 *
 * Returns the first ref found (sufficient for locating the field).
 * The `raw` field in the returned ref is the matched ref token, NOT the full string.
 */
function detectEmbeddedRef(value: string): SecretRef | null {
  // First try exact match (for whole-value refs)
  const exact = parseSecretRef(value);
  if (exact) return exact;

  // Then try embedded ${secret:...}
  const secretMatch = SECRET_EMBEDDED_RE.exec(value);
  if (secretMatch) {
    const name = secretMatch[1];
    if (name) {
      return { kind: "secret", name, raw: secretMatch[0] };
    }
  }

  // Then try embedded ${env:...}
  const envMatch = ENV_EMBEDDED_RE.exec(value);
  if (envMatch) {
    const name = envMatch[1];
    if (name) {
      return { kind: "env", name, raw: envMatch[0] };
    }
  }

  return null;
}

/**
 * Walks a `ScopeDocT` and extracts all secret references with their JSON paths.
 *
 * Fields examined:
 * - `env.*` (all env var values)
 * - `mcpServers.*.env.*` (server-level env)
 * - `mcpServers.*.headers.*` (server-level headers)
 * - `mcpServers.*.args.*` (server args, unusual but possible)
 * - `mcpServers.*.url` (SSE/HTTP server URLs, unusual but supported)
 *
 * Both exact refs (`${secret:foo}`) and embedded refs (`${env:PWD}/subdir`)
 * are detected.
 *
 * @param doc - The scope document to walk.
 * @returns Array of located secret references. Empty if none found.
 */
export function extractSecretRefs(doc: ScopeDocT): LocatedSecretRef[] {
  const results: LocatedSecretRef[] = [];

  // Walk top-level env
  for (const [key, value] of Object.entries(doc.env)) {
    const ref = detectEmbeddedRef(value);
    if (ref) {
      results.push({ ref, jsonPath: `env.${key}` });
    }
  }

  // Walk mcpServers
  for (const [serverName, server] of Object.entries(doc.mcpServers)) {
    if (!server) continue; // null tombstone (shouldn't be in effective doc, but guard anyway)

    // Server-level env
    if ("env" in server && server.env) {
      for (const [envKey, envVal] of Object.entries(server.env)) {
        const ref = detectEmbeddedRef(envVal);
        if (ref) {
          results.push({ ref, jsonPath: `mcpServers.${serverName}.env.${envKey}` });
        }
      }
    }

    // Server-level headers (HTTP/SSE)
    if ("headers" in server && server.headers) {
      for (const [headerKey, headerVal] of Object.entries(server.headers)) {
        const ref = detectEmbeddedRef(headerVal);
        if (ref) {
          results.push({ ref, jsonPath: `mcpServers.${serverName}.headers.${headerKey}` });
        }
      }
    }

    // Server-level args (stdio)
    if ("args" in server && Array.isArray(server.args)) {
      for (let i = 0; i < server.args.length; i++) {
        const arg = server.args[i];
        if (arg !== undefined) {
          const ref = detectEmbeddedRef(arg);
          if (ref) {
            results.push({ ref, jsonPath: `mcpServers.${serverName}.args[${i}]` });
          }
        }
      }
    }

    // URL field (SSE/HTTP servers may embed a ref, though unusual)
    if ("url" in server && typeof server.url === "string") {
      const ref = detectEmbeddedRef(server.url);
      if (ref) {
        results.push({ ref, jsonPath: `mcpServers.${serverName}.url` });
      }
    }
  }

  return results;
}

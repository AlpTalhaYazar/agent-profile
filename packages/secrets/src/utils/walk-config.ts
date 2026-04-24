/**
 * Utilities for walking an effective `ScopeDocT` and yielding
 * (jsonPath, value) pairs from the fields that may contain secret refs.
 *
 * This mirrors the field coverage in `@agent-profile/core`'s `extractSecretRefs`,
 * but yields mutable paths so the resolver can write resolved values back.
 */

import type { ScopeDocT } from "@agent-profile/core";

/**
 * A mutable reference to a string field within a config document.
 */
export interface ConfigField {
  /** JSON-path style identifier (e.g. `"mcpServers.github.env.TOKEN"`). */
  jsonPath: string;
  /** Current value of the field. */
  value: string;
  /**
   * Setter that writes a new value back into the original document.
   * The document is mutated in place.
   */
  set(newValue: string): void;
}

/**
 * Walks all string fields in a `ScopeDocT` that may contain secret references
 * and yields `ConfigField` descriptors with mutable setters.
 *
 * Fields covered:
 * - `env.*`
 * - `mcpServers.*.env.*`
 * - `mcpServers.*.headers.*`
 * - `mcpServers.*.args[*]`
 *
 * @param doc - The config document to walk. Mutated in place by `set()` calls.
 */
export function* walkConfig(doc: ScopeDocT): Generator<ConfigField> {
  // Top-level env
  for (const key of Object.keys(doc.env)) {
    const k = key;
    const currentValue = doc.env[k];
    if (currentValue !== undefined) {
      yield {
        jsonPath: `env.${k}`,
        value: currentValue,
        set(newValue: string) {
          doc.env[k] = newValue;
        },
      };
    }
  }

  // mcpServers fields
  for (const serverName of Object.keys(doc.mcpServers)) {
    const server = doc.mcpServers[serverName];
    if (!server) continue;

    // Server env
    if ("env" in server && server.env) {
      for (const envKey of Object.keys(server.env)) {
        const ek = envKey;
        const envVal = server.env[ek];
        if (envVal !== undefined) {
          yield {
            jsonPath: `mcpServers.${serverName}.env.${ek}`,
            value: envVal,
            set(newValue: string) {
              // Cast is safe: we confirmed "env" is in server above.
              (server as { env: Record<string, string> }).env[ek] = newValue;
            },
          };
        }
      }
    }

    // Server headers (HTTP/SSE)
    if ("headers" in server && server.headers) {
      for (const headerKey of Object.keys(server.headers)) {
        const hk = headerKey;
        const headerVal = server.headers[hk];
        if (headerVal !== undefined) {
          yield {
            jsonPath: `mcpServers.${serverName}.headers.${hk}`,
            value: headerVal,
            set(newValue: string) {
              (server as { headers: Record<string, string> }).headers[hk] = newValue;
            },
          };
        }
      }
    }

    // Server args (stdio)
    if ("args" in server && Array.isArray(server.args)) {
      for (let i = 0; i < server.args.length; i++) {
        const idx = i;
        const arg = server.args[idx];
        if (arg !== undefined) {
          yield {
            jsonPath: `mcpServers.${serverName}.args[${idx}]`,
            value: arg,
            set(newValue: string) {
              (server as { args: string[] }).args[idx] = newValue;
            },
          };
        }
      }
    }
  }
}

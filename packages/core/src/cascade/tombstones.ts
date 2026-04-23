import type { McpServerEntryT, McpServerT } from "../schema/index.js";

/**
 * Result of applying tombstone logic to a single server entry.
 */
export type TombstoneResult = { tombstoned: true } | { tombstoned: false; server: McpServerEntryT };

/**
 * Determines whether a server entry from a scope document is a tombstone.
 *
 * A tombstone is produced by any of:
 * 1. `null` value (explicit null in YAML)
 * 2. `enabled: false` on the server object
 *
 * @param server - The raw server value (may be null or an object).
 * @returns A discriminated result indicating tombstoned status.
 */
export function checkTombstone(server: McpServerEntryT | null): TombstoneResult {
  if (server === null) {
    return { tombstoned: true };
  }
  if (server.enabled === false) {
    return { tombstoned: true };
  }
  return { tombstoned: false, server };
}

/**
 * Returns true if the server entry is a patch (not a full server definition).
 * Patch entries either have `__merge: "deep"` OR `__extends` set, without
 * providing a full server definition (no required `command` or `url`).
 */
export function isMcpServerPatch(
  server: McpServerEntryT
): server is Exclude<McpServerEntryT, McpServerT> {
  // A full McpServer always has either `command` (stdio) or `url` (http/sse)
  // as non-optional required fields. Check if those are absent or optional.

  // Check if it has a non-empty command (required for stdio full server)
  const hasCommand =
    "command" in server && typeof server.command === "string" && server.command.length > 0;
  // Check if it has a non-empty url (required for http/sse full server)
  const hasUrl = "url" in server && typeof server.url === "string" && server.url.length > 0;

  // If it has neither command nor url, it must be a patch
  if (!hasCommand && !hasUrl) return true;

  // If it has either, it could be a full server
  return false;
}

/**
 * Applies `disabledServers` tombstones from a scope document.
 * Returns the list of server names that should be suppressed.
 *
 * @param disabledServers - The `disabledServers` array from a scope document.
 * @returns The same array (convenience; callers iterate it).
 */
export function getDisabledServerNames(disabledServers: string[]): string[] {
  return disabledServers;
}

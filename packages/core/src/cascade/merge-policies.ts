import type { McpServerEntryT, McpServerT } from "../schema/index.js";

/**
 * Deep-merges two MCP server objects, applying domain-specific rules:
 * - `args` always replace (never concatenate) to avoid argument chain surprises.
 * - `env` deep-merges (last-wins per key).
 * - `headers` deep-merges (last-wins per key).
 * - All other scalar fields: last-wins (higher-precedence `incoming` wins).
 *
 * `base` must be a complete `McpServerT`. `incoming` can be a full server
 * or a partial `McpServerPatchT` (used when `__merge: "deep"` is set).
 * The result is always typed as `McpServerT` because `base` supplies
 * all required fields for any missing in `incoming`.
 */
export function deepMergeServer(base: McpServerT, incoming: McpServerEntryT): McpServerT {
  // Use explicit field merging so we don't accidentally carry __extends/__merge directives
  // into the merged result in ways that could cause re-processing.
  const merged = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "args") {
      // args always replace
      merged[key] = value;
    } else if (key === "env" || key === "headers") {
      // deep-merge env/headers: base keys persist unless incoming overrides
      const baseObj = (merged[key] as Record<string, string> | undefined) ?? {};
      merged[key] = { ...baseObj, ...(value as Record<string, string>) };
    } else {
      // scalars: incoming wins
      merged[key] = value;
    }
  }

  return merged as McpServerT;
}

/**
 * Deduplicate an array while preserving order (first occurrence wins).
 * Used for persona arrays (claudeMd, agents, skills, slashCmds, memory).
 */
export function dedupArray<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

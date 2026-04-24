/**
 * Builders for Claude Code `mcp.json` content.
 */

import type { EffectiveConfig, McpServerT } from "@agent-profile/core";
import type { McpConfigFile } from "./types.js";

const AGENT_PROFILE_ONLY_KEYS = new Set(["enabled", "__merge", "__extends"]);

/**
 * Build the JSON object written to `mcp.json`.
 *
 * Agent Profile cascade-only fields are stripped because this file is consumed
 * by Claude Code, not by the Agent Profile resolver.
 */
export function buildMcpConfig(
  effective: EffectiveConfig,
  headersHelperPath: string | null
): {
  config: McpConfigFile;
  wroteHeadersHelper: boolean;
} {
  const mcpServers: Record<string, unknown> = {};
  let wroteHeadersHelper = false;

  for (const [name, server] of Object.entries(effective.mcpServers)) {
    const serialized = serializeMcpServer(server);

    if (headersHelperPath && shouldInjectHeadersHelper(serialized)) {
      serialized.headersHelper = headersHelperPath;
      wroteHeadersHelper = true;
    }

    mcpServers[name] = serialized;
  }

  return { config: { mcpServers }, wroteHeadersHelper };
}

/**
 * Return true when a server can use Claude Code's `headersHelper` field and
 * does not already provide one.
 */
export function shouldInjectHeadersHelper(server: Record<string, unknown>): boolean {
  const type = server.type;
  return (type === "http" || type === "streamable-http") && server.headersHelper === undefined;
}

/**
 * Convert a core MCP server entry to the Claude Code mcp.json server shape.
 */
function serializeMcpServer(server: McpServerT): Record<string, unknown> {
  const clone = structuredClone(server) as Record<string, unknown>;

  for (const key of AGENT_PROFILE_ONLY_KEYS) {
    delete clone[key];
  }

  return clone;
}

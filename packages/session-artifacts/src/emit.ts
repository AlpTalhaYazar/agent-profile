/**
 * Main entry point for session artifact emission.
 */

import { join } from "node:path";
import { deployPersona } from "@agent-profile/persona-deployer";
import { atomicWrite } from "./atomic-write.js";
import { DEFAULT_HELPER_EXECUTABLE, apiKeyHelperScript, headersHelperScript } from "./helpers.js";
import { buildMcpConfig } from "./mcp-config.js";
import { buildSettings } from "./settings.js";
import type { EmitSessionArtifactsInput, EmitSessionArtifactsResult } from "./types.js";

const JSON_INDENT = 2;

/**
 * Emit launch-ready runtime artifacts into an existing session directory.
 *
 * This function performs file generation only. It does not resolve secrets,
 * read a keychain, spawn `claude`, mutate process env, or create/delete the
 * session directory itself.
 *
 * @param input - Effective config and session directory metadata.
 * @returns Runtime paths plus persona deployment details.
 */
export async function emitSessionArtifacts(
  input: EmitSessionArtifactsInput
): Promise<EmitSessionArtifactsResult> {
  const { effective, session } = input;
  const helperExecutable = input.helperExecutable ?? DEFAULT_HELPER_EXECUTABLE;

  const mcpConfigPath = join(session.sessionDir, "mcp.json");
  const settingsPath = join(session.sessionDir, "settings.json");
  const apiKeyHelperPath =
    input.authMode === "apiKey" ? join(session.sessionDir, "apiKeyHelper.sh") : null;

  const needsHeadersHelper = hasServerNeedingHeadersHelper(effective);
  const headersHelperPath = needsHeadersHelper
    ? join(session.sessionDir, "headersHelper.sh")
    : null;

  if (apiKeyHelperPath) {
    await atomicWrite(apiKeyHelperPath, apiKeyHelperScript(helperExecutable), 0o700);
  }

  if (headersHelperPath) {
    await atomicWrite(headersHelperPath, headersHelperScript(helperExecutable), 0o700);
  }

  const { config: mcpConfig } = buildMcpConfig(effective, headersHelperPath);
  const settings = buildSettings(effective, apiKeyHelperPath);

  await atomicWrite(mcpConfigPath, `${JSON.stringify(mcpConfig, null, JSON_INDENT)}\n`);
  await atomicWrite(settingsPath, `${JSON.stringify(settings, null, JSON_INDENT)}\n`);

  const persona = await deployPersona(
    effective.persona,
    session.sessionDir,
    session.claudeConfigDir,
    {
      onMissingSource: input.onMissingSource ?? "throw",
    }
  );

  return {
    runtimePaths: {
      sessionDir: session.sessionDir,
      claudeConfigDir: session.claudeConfigDir,
      mcpConfig: mcpConfigPath,
      settings: settingsPath,
      apiKeyHelper: apiKeyHelperPath,
      headersHelper: headersHelperPath,
      claudeMd: persona.claudeMdPath,
    },
    persona,
  };
}

/**
 * Return true when at least one effective MCP server is a remote HTTP server
 * that does not already carry an explicit `headersHelper`.
 */
function hasServerNeedingHeadersHelper(effective: EmitSessionArtifactsInput["effective"]): boolean {
  for (const server of Object.values(effective.mcpServers)) {
    if (
      "url" in server &&
      (server.type === "http" || server.type === "streamable-http") &&
      server.headersHelper === undefined
    ) {
      return true;
    }
  }

  return false;
}

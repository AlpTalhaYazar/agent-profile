/**
 * @module @agent-profile/session-artifacts
 *
 * Pure I/O package that emits Claude Code runtime artifacts from an effective
 * Agent Profile config and an existing ephemeral session directory.
 */

export { emitSessionArtifacts } from "./emit.js";
export { buildMcpConfig, shouldInjectHeadersHelper } from "./mcp-config.js";
export { buildSettings } from "./settings.js";
export {
  DEFAULT_HELPER_EXECUTABLE,
  apiKeyHelperScript,
  headersHelperScript,
  shellCommand,
  shellQuote,
} from "./helpers.js";

export type {
  AuthMode,
  EmitSessionArtifactsInput,
  EmitSessionArtifactsResult,
  McpConfigFile,
  SessionRuntimePaths,
} from "./types.js";

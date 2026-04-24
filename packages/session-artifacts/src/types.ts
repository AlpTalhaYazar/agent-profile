import type { EffectiveConfig } from "@agent-profile/core";
import type {
  DeployPersonaOpts,
  DeploymentResult,
  SessionInfo,
} from "@agent-profile/persona-deployer";

/** Supported Anthropic auth modes carried by auth profiles. */
export type AuthMode = "apiKey" | "bedrock" | "vertex" | "gateway";

/**
 * Runtime file paths produced by `emitSessionArtifacts`.
 *
 * These paths are consumed later by the launch command when it builds the
 * `claude` process environment and CLI arguments.
 */
export interface SessionRuntimePaths {
  /** Session root directory, e.g. `~/.myclaude/sessions/<uuid>`. */
  sessionDir: string;
  /** `.claude` subdirectory to pass as `CLAUDE_CONFIG_DIR`. */
  claudeConfigDir: string;
  /** Path to the generated `mcp.json` file. */
  mcpConfig: string;
  /** Path to the generated `settings.json` file. */
  settings: string;
  /** Path to `apiKeyHelper.sh`, or `null` when not needed. */
  apiKeyHelper: string | null;
  /** Path to `headersHelper.sh`, or `null` when no server needs it. */
  headersHelper: string | null;
  /** Path to rendered `CLAUDE.md`, or `null` when no CLAUDE.md sources exist. */
  claudeMd: string | null;
}

/**
 * Input to `emitSessionArtifacts`.
 */
export interface EmitSessionArtifactsInput {
  /**
   * Effective config from `@agent-profile/core`, optionally already passed
   * through `@agent-profile/secrets.resolveSecrets` by the caller.
   */
  effective: EffectiveConfig;

  /** Existing session directory metadata from `createSessionDir()`. */
  session: SessionInfo;

  /** Active Anthropic auth mode. `apiKey` emits `apiKeyHelper.sh`. */
  authMode?: AuthMode;

  /** Helper executable invoked by generated wrapper scripts. */
  helperExecutable?: string;

  /** Missing persona source policy passed through to `deployPersona`. */
  onMissingSource?: DeployPersonaOpts["onMissingSource"];
}

/**
 * Result from `emitSessionArtifacts`.
 */
export interface EmitSessionArtifactsResult {
  /** Runtime paths for every generated artifact. */
  runtimePaths: SessionRuntimePaths;
  /** Result returned by `deployPersona()`. */
  persona: DeploymentResult;
}

/**
 * JSON shape written to `mcp.json`.
 */
export interface McpConfigFile {
  mcpServers: Record<string, unknown>;
}

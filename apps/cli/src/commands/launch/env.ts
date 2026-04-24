import type { EffectiveConfig } from "@agent-profile/core";

/** Auth modes that affect Claude Code launch-time provider environment. */
export type LaunchAuthMode = "apiKey" | "bedrock" | "vertex" | "gateway";

/** Runtime artifact paths needed by the Claude Code process. */
export interface ClaudeLaunchRuntimePaths {
  sessionDir: string;
  claudeConfigDir: string;
  mcpConfig: string;
  settings: string;
}

/** Session metadata needed for launch-time env construction. */
export interface ClaudeLaunchSession {
  sessionId: string;
  sessionDir: string;
  claudeConfigDir: string;
}

/** Inputs for building the environment passed to Claude Code. */
export interface BuildClaudeLaunchEnvInput {
  baseEnv?: NodeJS.ProcessEnv;
  effective: Pick<EffectiveConfig, "env">;
  runtimePaths: ClaudeLaunchRuntimePaths;
  sessionId: string;
  capabilityToken: string;
  sessionsRoot: string;
  authMode: LaunchAuthMode;
}

/** Compatibility input shape used by launch orchestration. */
export interface BuildClaudeEnvInput {
  baseEnv?: NodeJS.ProcessEnv;
  effectiveEnv: Record<string, string>;
  session: ClaudeLaunchSession;
  runtimePaths: ClaudeLaunchRuntimePaths;
  capabilityToken: string;
  sessionsRoot: string;
  authMode: LaunchAuthMode;
}

const ANTHROPIC_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;
const PROVIDER_ENV_KEYS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"] as const;

/**
 * Build the Claude Code argv for runtime artifact paths.
 */
export function buildClaudeLaunchArgs(
  runtimePaths: Pick<ClaudeLaunchRuntimePaths, "mcpConfig" | "settings">
): string[] {
  return ["--mcp-config", runtimePaths.mcpConfig, "--settings", runtimePaths.settings];
}

/**
 * Build the environment for the spawned Claude Code process.
 */
export function buildClaudeLaunchEnv(input: BuildClaudeLaunchEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(input.baseEnv ?? process.env),
    ...input.effective.env,
  };

  for (const key of ANTHROPIC_ENV_KEYS) {
    delete env[key];
  }

  for (const key of PROVIDER_ENV_KEYS) {
    delete env[key];
  }

  env.CLAUDE_CONFIG_DIR = input.runtimePaths.claudeConfigDir;
  env.MYCLAUDE_SESSION_ID = input.sessionId;
  env.MYCLAUDE_CAPABILITY_TOKEN = input.capabilityToken;
  env.MYCLAUDE_SESSIONS_ROOT = input.sessionsRoot;

  if (input.authMode === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
  } else if (input.authMode === "vertex") {
    env.CLAUDE_CODE_USE_VERTEX = "1";
  }

  return env;
}

/**
 * Build the Claude Code environment from launch orchestration inputs.
 */
export function buildClaudeEnv(input: BuildClaudeEnvInput): NodeJS.ProcessEnv {
  return buildClaudeLaunchEnv({
    effective: { env: input.effectiveEnv },
    runtimePaths: input.runtimePaths,
    sessionId: input.session.sessionId,
    capabilityToken: input.capabilityToken,
    sessionsRoot: input.sessionsRoot,
    authMode: input.authMode,
    ...(input.baseEnv ? { baseEnv: input.baseEnv } : {}),
  });
}

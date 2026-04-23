import type { McpServerT } from "../schema/index.js";

/**
 * Named scope identifiers used throughout the cascade engine.
 * These correspond 1:1 with file paths in `~/.myclaude/` and `<project>/.myclaude/`.
 */
export type ScopeName =
  | "global-shared"
  | "global-role"
  | "project-shared"
  | "project-shared-local"
  | "project-role"
  | "launch-overrides"
  | string; // allow custom names for monorepo sub-packages

/**
 * A scope layer after loading and Zod-parsing.
 * Carries the resolved file path for error messages.
 */
export interface ScopeLayer {
  /** Human-readable scope name for provenance. */
  name: ScopeName;
  /** Absolute path of the YAML file that was loaded (used in error messages). */
  filePath: string;
  /** Parsed and validated scope document. */
  doc: import("../schema/index.js").ScopeDocT;
}

/**
 * A scope layer that was expected but not present on disk.
 * These are skipped silently but recorded in provenance.
 */
export interface MissingScopeLayer {
  name: ScopeName;
  filePath: string;
  present: false;
}

/**
 * Provenance record for a single MCP server entry.
 */
export interface McpServerProvenance {
  /** The scope that ultimately supplied this server's final value. */
  source: ScopeName;
  /** If the server was tombstoned, the scope that tombstoned it. */
  suppressedBy?: ScopeName;
  /** Field names within this server that were overridden by later scopes. */
  overriddenFields?: string[];
  /**
   * Full audit chain: introduction, inheritance, overrides, suppression events.
   */
  chain: Array<{
    scope: ScopeName;
    event: "introduced" | "extended" | "replaced" | "suppressed" | "deep-merged";
  }>;
}

/**
 * Provenance record for a single env var or settings key.
 */
export interface FieldProvenance {
  /** The scope that ultimately supplied this value. */
  source: ScopeName;
  /** All scopes in the order they contributed (first = earliest, last = winning). */
  chain: ScopeName[];
}

/**
 * Provenance record for persona files contributed by one scope.
 */
export interface PersonaProvenance {
  source: ScopeName;
  files: string[];
}

/**
 * Full provenance output from `resolve()`.
 */
export interface Provenance {
  mcpServers: Record<string, McpServerProvenance>;
  env: Record<string, FieldProvenance>;
  settings: Record<string, FieldProvenance>;
  persona: PersonaProvenance[];
}

/**
 * The resolved MCP servers map (suppressed entries are absent).
 */
export type ResolvedMcpServers = Record<string, McpServerT>;

/**
 * The effective configuration after full cascade resolution.
 * Secret references are parsed (as refs) but NOT resolved at this layer.
 */
export interface EffectiveConfig {
  mcpServers: ResolvedMcpServers;
  env: Record<string, string>;
  settings: Record<string, unknown>;
  persona: {
    claudeMd: string[];
    agents: string[];
    skills: string[];
    slashCmds: string[];
    memory: string[];
  };
  auth?: { profileId: string };
}

/**
 * The return value of `resolve()`.
 * `runtimePaths` is always `null` at the core layer; the CLI/GUI emitter
 * populates it when ephemeral session directories are written.
 */
export interface EffectiveSessionConfig {
  effective: EffectiveConfig;
  provenance: Provenance;
  /**
   * Always `null` in `packages/core`. Populated by the caller after
   * writing ephemeral session files (packages/persona-deployer, etc.).
   */
  runtimePaths: null;
}

/**
 * A LayerSource describes one step in a provenance chain.
 */
export interface LayerSource {
  scope: ScopeName;
  filePath: string;
}

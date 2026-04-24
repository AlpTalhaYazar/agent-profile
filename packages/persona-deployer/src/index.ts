/**
 * @module @agent-profile/persona-deployer
 *
 * Pure I/O package that materializes the `persona` section from
 * `@agent-profile/core`'s `EffectiveSessionConfig` into an ephemeral
 * session directory structured for Claude Code's `CLAUDE_CONFIG_DIR`.
 *
 * No process spawn, no network, no environment mutation beyond the function
 * arguments. All writes are atomic (temp + rename).
 */

// ─── Main entry points ────────────────────────────────────────────────────────

export { deployPersona } from "./deploy.js";
export {
  createSessionDir,
  cleanupSession,
  listOrphanedSessions,
  sessionsRootDefault,
} from "./session-dir.js";

// ─── Path safety ─────────────────────────────────────────────────────────────

export { isPathWithinRoot } from "./path-safety.js";

// ─── Errors ──────────────────────────────────────────────────────────────────

export { PersonaDeployError, SessionPathUnsafeError, SourceFileNotFoundError } from "./errors.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type {
  DeployPersonaInput,
  DeployPersonaOpts,
  DeploymentResult,
  CollisionLogEntry,
  MissingSourceEntry,
  SessionInfo,
  OrphanedSession,
  FileCategory,
} from "./utils/types.js";

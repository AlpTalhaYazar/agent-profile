/**
 * Internal and public types for `@agent-profile/persona-deployer`.
 */

/**
 * Persona input categories for file deployment.
 *
 * Internal disk-layout names used by `copyFiles` and `deployPersona`. The
 * legacy `commands` literal matches the on-disk subdirectory; the public
 * `renderPersonaInMemory` boundary remaps it to `slashCmds` for parity with
 * the cascade output (`EffectiveConfig.persona.slashCmds`).
 */
export type FileCategory = "agents" | "skills" | "commands" | "memory";

/**
 * A record of one filename collision during deployment.
 *
 * Collision semantics: **later wins**. When two source files map to the same
 * basename within the same category, the later one in the input array
 * overwrites the earlier one. Every overwrite is recorded here so callers can
 * audit or surface the information in provenance UIs.
 *
 * Three-way collisions: if three files share the same basename (A → B → C),
 * two entries are recorded:
 *
 * 1. `{ overriddenSource: A, winningSource: B }` — when B overtook A
 * 2. `{ overriddenSource: B, winningSource: C }` — when C overtook B
 *
 * This "step-by-step" log means the caller always has the full overwrite
 * chain rather than just the first and last entry.
 *
 * `category` carries either the internal disk name (`commands`) when produced
 * by `copyFiles` / `deployPersona`, or the public-facing name (`slashCmds`)
 * when produced by `renderPersonaInMemory`. Callers that mix the two paths
 * should normalise on the public name.
 */
export interface CollisionLogEntry {
  /** Basename of the deployed file, e.g. `code-reviewer.md`. */
  target: string;
  /** Category the collision occurred in. */
  category: FileCategory | "slashCmds";
  /** Absolute source path of the file that was overwritten. */
  overriddenSource: string;
  /** Absolute source path of the file that won. */
  winningSource: string;
}

/**
 * A record of one missing source file when `onMissingSource: 'skip'` is set.
 *
 * `category` carries either the internal disk name (`commands`) or the
 * public-facing name (`slashCmds`); see `CollisionLogEntry.category` for the
 * same caveat.
 */
export interface MissingSourceEntry {
  /** Persona category the missing file belongs to. */
  category: FileCategory | "slashCmds" | "claudeMd";
  /** Absolute path that was expected to exist. */
  sourcePath: string;
  /** Absolute path where the file would have been deployed. */
  targetPath: string;
}

/**
 * The result produced by `deployPersona()`.
 */
export interface DeploymentResult {
  /**
   * Absolute path of the rendered `CLAUDE.md` inside the session dir,
   * or `null` when the `claudeMd` input array was empty.
   */
  claudeMdPath: string | null;

  /**
   * Absolute paths of every file that was written (agents, skills, commands,
   * memory seeds). Does not include `CLAUDE.md` — check `claudeMdPath`.
   */
  writtenFiles: string[];

  /**
   * All filename collisions that occurred during deployment.
   * Later source always wins; each overwrite step is logged separately.
   */
  collisions: CollisionLogEntry[];

  /**
   * Source files that were skipped because they were missing on disk.
   * Only populated when `opts.onMissingSource === 'skip'`.
   */
  missingSources: MissingSourceEntry[];
}

/**
 * Full input descriptor for `deployPersona()`.
 */
export interface DeployPersonaInput {
  /**
   * Resolved, absolute paths to CLAUDE.md fragments in cascade order
   * (global-shared first, project-role last).
   */
  claudeMd: string[];

  /** Absolute paths to agent definition files. */
  agents: string[];

  /** Absolute paths to skill definition files. */
  skills: string[];

  /** Absolute paths to slash-command files. */
  slashCmds: string[];

  /** Absolute paths to memory seed files. */
  memory: string[];

  /**
   * Optional per-path provenance labels used in CLAUDE.md source markers.
   * Key = absolute source path; value = human-readable scope tag
   * (e.g. `"global-role/backend"`).
   *
   * When a path is absent from the map the source marker falls back to the
   * file path itself. Source tags must never contain secret values.
   */
  provenanceMap?: Record<string, string>;
}

/**
 * Options controlling `deployPersona()` behaviour.
 */
export interface DeployPersonaOpts {
  /**
   * What to do when a source file does not exist on disk.
   *
   * - `'throw'` (default): immediately throws `SourceFileNotFoundError`.
   * - `'skip'`: logs the missing file in `DeploymentResult.missingSources`
   *   and continues with the remaining files.
   */
  onMissingSource?: "throw" | "skip";
}

/**
 * Session directory metadata returned by `createSessionDir()`.
 */
export interface SessionInfo {
  /** UUID that uniquely identifies this session. */
  sessionId: string;

  /**
   * Absolute path to the session root, e.g.
   * `~/.myclaude/sessions/<uuid>`.
   */
  sessionDir: string;

  /**
   * Absolute path to the `.claude` subdirectory — the value to pass as
   * `CLAUDE_CONFIG_DIR`.
   */
  claudeConfigDir: string;
}

/**
 * One entry returned by `listOrphanedSessions()`.
 */
export interface OrphanedSession {
  /** The session UUID. */
  sessionId: string;
  /** Absolute path to the session directory. */
  sessionDir: string;
  /** `mtime` of the session directory in milliseconds since the Unix epoch. */
  createdAtMs: number;
  /** Age of the directory in milliseconds. */
  ageMs: number;
}

/**
 * Public-facing persona file category as exposed by `renderPersonaInMemory`.
 *
 * Mirrors the `EffectiveConfig.persona` array names — slash commands are named
 * `slashCmds` (not `commands`) so consumers can index the result in lockstep
 * with the cascade output. See `FileCategory` for the internal disk-deployment
 * variant which keeps the legacy `commands` directory key.
 */
export type PersonaRenderCategory = "agents" | "skills" | "slashCmds" | "memory";

/**
 * One CLAUDE.md fragment (raw, no source-marker prefix) returned alongside the
 * combined render output.
 */
export interface PersonaClaudeMdSectionEntry {
  /** Absolute path of the source fragment on disk. */
  sourcePath: string;
  /**
   * Origin scope label looked up from `provenanceMap`. Falls back to the
   * literal string `"unknown"` when the path is not present in the map.
   */
  originScope: string;
  /** Raw fragment content (UTF-8) read verbatim from disk. */
  content: string;
}

/**
 * Combined CLAUDE.md preview returned by `renderPersonaInMemory`.
 */
export interface PersonaRenderClaudeMd {
  /**
   * Concatenated CLAUDE.md content with `<!-- source: ... -->` markers — the
   * exact same string `buildClaudeMd` produces.
   */
  combinedContent: string;
  /**
   * Per-fragment breakdown: caller can render each section independently in a
   * UI without re-parsing the combined string.
   */
  sections: PersonaClaudeMdSectionEntry[];
}

/**
 * One persona file entry returned by `renderPersonaInMemory`.
 *
 * Content is decoded as UTF-8. Persona files in the cascade are markdown,
 * YAML, or JSON — never binary.
 */
export interface PersonaRenderFile {
  /** Public-facing category name (`slashCmds`, not `commands`). */
  category: PersonaRenderCategory;
  /** File basename (e.g. `code-reviewer.md`). */
  basename: string;
  /** Absolute path of the source file on disk. */
  sourcePath: string;
  /**
   * Origin scope label looked up from `provenanceMap`. Falls back to the
   * literal string `"unknown"` when the path is not present in the map.
   */
  originScope: string;
  /** UTF-8 decoded file content. */
  content: string;
}

/**
 * Input to `renderPersonaInMemory`.
 */
export interface PersonaRenderInput {
  /**
   * The `persona` section of an `EffectiveConfig` produced by the cascade —
   * five ordered absolute-path arrays (`claudeMd`, `agents`, `skills`,
   * `slashCmds`, `memory`).
   */
  effective: {
    claudeMd: string[];
    agents: string[];
    skills: string[];
    slashCmds: string[];
    memory: string[];
  };
  /**
   * Per-path origin labels keyed by absolute source path. Values are
   * `ScopeName`-typed scope labels (e.g. `"global-role"`, `"project-shared"`).
   * Paths absent from the map fall back to the literal `"unknown"` string.
   */
  provenanceMap: Record<string, string>;
  /**
   * What to do when a source file does not exist on disk.
   *
   * - `"skip"` (default): record the missing path in `missingSources` and
   *   continue.
   * - `"throw"`: raise `SourceFileNotFoundError` immediately.
   */
  onMissingSource?: "throw" | "skip";
}

/**
 * Output of `renderPersonaInMemory`.
 */
export interface PersonaRenderResult {
  /**
   * Combined CLAUDE.md preview plus per-section breakdown, or `null` when
   * `effective.claudeMd` is empty.
   */
  claudeMd: PersonaRenderClaudeMd | null;
  /** Flat array of agent + skill + slashCmd + memory files. */
  files: PersonaRenderFile[];
  /**
   * Filename collisions detected within each category. The `category` field
   * uses the public-facing name (`slashCmds`, not `commands`).
   */
  collisions: CollisionLogEntry[];
  /** Missing source files (only when `onMissingSource === "skip"`). */
  missingSources: MissingSourceEntry[];
}

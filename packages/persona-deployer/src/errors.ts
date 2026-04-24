/**
 * Error classes for `@agent-profile/persona-deployer`.
 *
 * Each error carries the offending path and a category string so callers can
 * distinguish error types without parsing the message.
 */

/**
 * Base class for all persona-deployer errors.
 * Carries the offending path and a machine-readable category.
 */
export class PersonaDeployError extends Error {
  /** Machine-readable error category. */
  readonly category: string;
  /** The file-system path involved in the error. */
  readonly path: string;

  constructor(message: string, category: string, path: string) {
    super(message);
    this.name = "PersonaDeployError";
    this.category = category;
    this.path = path;
    // Maintain proper prototype chain in ES5/CommonJS envs (not strictly needed
    // for ESM Node 22, but harmless and future-proofs transpiled builds).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a requested cleanup path is outside every allowed root.
 *
 * This is a hard safety guard: `cleanupSession` will never `rm -rf` a
 * directory that does not live under an allowed root, even if the path was
 * produced by a bug in the caller.
 */
export class SessionPathUnsafeError extends PersonaDeployError {
  /** The allowed roots that were checked. */
  readonly allowedRoots: readonly string[];

  constructor(sessionDir: string, allowedRoots: readonly string[]) {
    super(
      `Session path is outside every allowed root and will not be deleted: ${sessionDir}`,
      "SessionPathUnsafe",
      sessionDir
    );
    this.name = "SessionPathUnsafeError";
    this.allowedRoots = allowedRoots;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a persona source file does not exist on disk.
 *
 * Contains the `category` (agents / skills / commands / memory / claudeMd),
 * the `sourcePath` that was missing, and the `targetPath` where it would have
 * been deployed so callers can report actionable information.
 */
export class SourceFileNotFoundError extends PersonaDeployError {
  /** The persona category the file belongs to. */
  readonly fileCategory: "agents" | "skills" | "commands" | "memory" | "claudeMd";
  /** The path that was expected to exist. */
  readonly sourcePath: string;
  /** The path where the file would have been deployed. */
  readonly targetPath: string;

  constructor(
    fileCategory: "agents" | "skills" | "commands" | "memory" | "claudeMd",
    sourcePath: string,
    targetPath: string
  ) {
    super(
      `Source file not found (${fileCategory}): ${sourcePath} → ${targetPath}`,
      "SourceFileNotFound",
      sourcePath
    );
    this.name = "SourceFileNotFoundError";
    this.fileCategory = fileCategory;
    this.sourcePath = sourcePath;
    this.targetPath = targetPath;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

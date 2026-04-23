import type { ZodError } from "zod";

/**
 * Base error class for all `@agent-profile/core` errors.
 * Subclasses add `sourceFile` and `fieldPath` for user-facing diagnostics.
 */
export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a Zod schema parse fails on a scope/fragment/auth-profiles file.
 *
 * The error message includes:
 * - The source file path (for user-facing `Error in <path>` prefix)
 * - The Zod field path (JSON path notation)
 * - The Zod message
 */
export class SchemaError extends CoreError {
  /** Absolute path of the YAML file that failed validation. */
  readonly sourceFile: string;
  /** JSON-path of the field that failed (e.g. `mcpServers.postgres.env.DATABASE_URL`). */
  readonly fieldPath: string;
  /** The underlying Zod error. */
  readonly zodError: ZodError;

  constructor(sourceFile: string, zodError: ZodError) {
    const firstIssue = zodError.issues[0];
    const fieldPath = firstIssue ? firstIssue.path.join(".") : "(root)";
    const zodMsg = firstIssue ? firstIssue.message : zodError.message;

    super(`Error in ${sourceFile}\n  ${fieldPath || "(root)"}\n  ${zodMsg}`);
    this.sourceFile = sourceFile;
    this.fieldPath = fieldPath;
    this.zodError = zodError;
  }
}

/**
 * Thrown when a layer references a fragment name that cannot be found
 * in any of the searched fragment directories.
 */
export class FragmentNotFoundError extends CoreError {
  /** The fragment name that was not found. */
  readonly fragmentName: string;
  /** Directories that were searched. */
  readonly searchedPaths: string[];

  constructor(fragmentName: string, searchedPaths: string[]) {
    super(
      `Fragment "${fragmentName}" not found.\n  Searched paths:\n${searchedPaths.map((p) => `    - ${p}`).join("\n")}`
    );
    this.fragmentName = fragmentName;
    this.searchedPaths = searchedPaths;
  }
}

/**
 * Thrown when the cascade algorithm encounters a logical error,
 * such as a `__extends` target that cannot be resolved or
 * mutually-exclusive directives.
 */
export class CascadeError extends CoreError {
  /** The scope name where the error occurred. */
  readonly scopeName: string;
  /** JSON path of the problematic field. */
  readonly fieldPath: string;

  constructor(scopeName: string, fieldPath: string, message: string) {
    super(`Cascade error in scope "${scopeName}" at ${fieldPath}: ${message}`);
    this.scopeName = scopeName;
    this.fieldPath = fieldPath;
  }
}

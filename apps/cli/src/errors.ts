/**
 * @module errors
 *
 * CLI-level error types and exit-code mapping.
 *
 * Exit codes per `docs/04-cli-spec.md`:
 * - 0  Success
 * - 1  Generic error
 * - 2  Config invalid (Zod validation failure)
 * - 3  Auth failure / keychain unavailable / secret resolution failure
 * - 4  Daemon unreachable (not used this sprint)
 * - 5  Spawn failure
 * - 6  User cancelled
 * - 130 Interrupted (SIGINT)
 */
import { CascadeError, CoreError, FragmentNotFoundError, SchemaError } from "@agent-profile/core";

/** Exit code 0: success. */
export const EXIT_SUCCESS = 0;
/** Exit code 1: generic error. */
export const EXIT_GENERIC = 1;
/** Exit code 2: config/schema validation failure. */
export const EXIT_CONFIG_INVALID = 2;
/** Exit code 3: auth failure / keychain unavailable / secret resolution failure. */
export const EXIT_AUTH_FAILURE = 3;
/** Exit code 4: daemon unreachable (started or required, but not connectable). */
export const EXIT_DAEMON_UNREACHABLE = 4;
/** Exit code 5: failed to spawn the child process. */
export const EXIT_SPAWN_FAILURE = 5;
/** Exit code 6: user cancelled (declined prompt). */
export const EXIT_USER_CANCELLED = 6;
/** Exit code 130: SIGINT / interrupted. */
export const EXIT_INTERRUPTED = 130;

/**
 * A CLI-level error that carries an exit code and an optional hint message.
 */
export class CliError extends Error {
  /** The process exit code to use. */
  readonly exitCode: number;
  /** An optional actionable hint shown to the user. */
  readonly hint?: string;

  constructor(message: string, exitCode = EXIT_GENERIC, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    if (hint !== undefined) {
      this.hint = hint;
    }
  }
}

/**
 * Maps a `CoreError` subclass to a CLI exit code and user-facing message.
 *
 * @param err - Any error (CoreError or otherwise).
 * @returns `{ exitCode, message, hint? }` for display.
 */
export function mapCoreError(err: unknown): { exitCode: number; message: string; hint?: string } {
  if (err instanceof SchemaError) {
    return {
      exitCode: EXIT_CONFIG_INVALID,
      message: err.message,
      hint: `Fix the YAML at ${err.sourceFile} and run again.`,
    };
  }

  if (err instanceof FragmentNotFoundError) {
    return {
      exitCode: EXIT_CONFIG_INVALID,
      message: err.message,
      hint: "Ensure the fragment file exists and is in the fragments directory.",
    };
  }

  if (err instanceof CascadeError) {
    return {
      exitCode: EXIT_CONFIG_INVALID,
      message: err.message,
      hint: `Check the cascade config in scope "${(err as CascadeError).scopeName}" at field "${(err as CascadeError).fieldPath}".`,
    };
  }

  if (err instanceof CoreError) {
    return {
      exitCode: EXIT_GENERIC,
      message: err.message,
    };
  }

  if (err instanceof CliError) {
    const result: { exitCode: number; message: string; hint?: string } = {
      exitCode: err.exitCode,
      message: err.message,
    };
    if (err.hint !== undefined) result.hint = err.hint;
    return result;
  }

  if (err instanceof Error) {
    return { exitCode: EXIT_GENERIC, message: err.message };
  }

  return { exitCode: EXIT_GENERIC, message: String(err) };
}

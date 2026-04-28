/**
 * @module errors
 *
 * Error types for `@agent-profile/cli-services`.
 *
 * Services do NOT format messages for end users. They throw a small set of
 * tagged errors that callers (the CLI binary, or the desktop daemon's IPC
 * handlers) translate into their respective surface. The CLI maps these to
 * its `CliError` exit codes; the daemon maps them to IPC error codes.
 *
 * The codes are strings rather than integers so they round-trip cleanly through
 * JSON over the IPC wire. We additionally carry an integer `exitCode` because
 * the CLI's existing public contract — including third-party scripts that call
 * `myclaude` and check exit codes — has long surfaced "config invalid = 2",
 * "session not found = 2", and "auth = 3". Re-exporting `loadAuthProfiles`
 * verbatim from the CLI must preserve that contract without forcing the CLI
 * to re-wrap every thrown error.
 */

/**
 * Stable error codes emitted by services.
 *
 * - `config-invalid`: a YAML/JSON file failed to parse or violated the schema.
 * - `not-found`: the requested entity (session id, auth profile id) does not
 *   exist on disk. Distinct from "no records exist" — services return empty
 *   arrays for the latter.
 * - `io-error`: an unexpected filesystem error (permission denied, etc.). The
 *   underlying `cause` carries the original `Error`.
 */
export type ServiceErrorCode = "config-invalid" | "not-found" | "io-error";

/**
 * The error type thrown by every service in this package.
 *
 * Carries a stable `code` so callers can map to their surface (CLI exit code,
 * IPC error code, etc.) without parsing the message. The original error, if
 * any, is preserved on `cause`. The `exitCode` is the CLI's process-exit
 * convention and is forwarded so that re-exporting helpers (`loadAuthProfiles`,
 * `readSessionRecord`) preserve their existing contract.
 */
export class ServiceError extends Error {
  /** Stable, machine-readable error code. See `ServiceErrorCode`. */
  readonly code: ServiceErrorCode;
  /** CLI process-exit code mapped from `code`. Mirrors `apps/cli/src/errors.ts`. */
  readonly exitCode: number;

  /**
   * @param code - The stable error code.
   * @param message - A human-readable description. Callers may show this
   *   verbatim or wrap it in a surface-specific prefix.
   * @param cause - The underlying error, if any. Forwarded to `Error.cause`.
   */
  constructor(code: ServiceErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ServiceError";
    this.code = code;
    this.exitCode = serviceExitCode(code);
  }
}

/** Map a `ServiceErrorCode` to the matching CLI exit code. */
function serviceExitCode(code: ServiceErrorCode): number {
  switch (code) {
    case "config-invalid":
    case "not-found":
      return 2;
    case "io-error":
      return 1;
  }
}

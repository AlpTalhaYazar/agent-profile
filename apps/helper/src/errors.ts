/**
 * @module errors
 *
 * Helper-local exit codes and the `HelperError` class.
 *
 * Exit codes are distinct from the main CLI's codes because the helper has a
 * different failure surface (no config/cascade concepts; capability tokens and
 * session lookups dominate instead).
 *
 * | Code | Meaning                                                        |
 * |------|----------------------------------------------------------------|
 * | 0    | Success                                                        |
 * | 1    | Generic/unexpected error                                       |
 * | 2    | Usage error (bad argv)                                         |
 * | 3    | Auth/secret failure (keychain unavailable, secret missing)     |
 * | 4    | Daemon unreachable — reserved for the future IPC helper client |
 * | 5    | Unknown session or missing/invalid session manifest entry      |
 * | 6    | Capability token denied                                        |
 * | 130  | Interrupted (SIGINT)                                           |
 *
 * `HelperError` pairs a short operator-facing message with an `exitCode`. Error
 * messages MUST NOT contain secret values; keep them to ref identifiers and
 * structural descriptions.
 */

/** Exit code 0: success. */
export const EXIT_OK = 0;
/** Exit code 1: generic/unexpected error. */
export const EXIT_GENERIC = 1;
/** Exit code 2: usage error (bad argv). */
export const EXIT_USAGE = 2;
/** Exit code 3: auth/secret failure. */
export const EXIT_AUTH = 3;
/** Exit code 4: daemon unreachable. Reserved for the IPC helper client. */
export const EXIT_DAEMON_UNREACHABLE = 4;
/** Exit code 5: unknown session or missing entry in the session manifest. */
export const EXIT_SESSION_UNKNOWN = 5;
/** Exit code 6: capability token did not match. */
export const EXIT_CAPABILITY_DENIED = 6;
/** Exit code 130: interrupted by SIGINT. */
export const EXIT_INTERRUPTED = 130;

/**
 * An error carrying a stable helper exit code.
 *
 * Throw from a `HelperClient` implementation or from the CLI runner when a
 * specific exit code is required. The runner catches `HelperError` and writes
 * `message` to stderr (and only stderr) before exiting with `exitCode`.
 */
export class HelperError extends Error {
  /** The process exit code to use. */
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "HelperError";
    this.exitCode = exitCode;
  }
}

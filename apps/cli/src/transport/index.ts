/**
 * @module transport
 *
 * Public entry for the CLI's transport adapter.
 *
 * `getTransport` is the single source of truth for "should this command go
 * through the daemon or run in-process". Resolution order:
 *
 *  1. `MYCLAUDE_FORCE_STANDALONE=1` env or `opts.standalone === true` →
 *     always returns `InProcTransport`. Used by tests and by users who want
 *     the offline path explicitly.
 *  2. Otherwise: try to read the boot cookie, resolve the socket path, open
 *     a connection, and complete the IPC handshake. The whole attempt is
 *     bounded by the daemon-attempt timeout (default 1s) so CLI startup
 *     stays fast when no daemon is running.
 *  3. On any failure: if `opts.requireDaemon === true`, throw a
 *     `CliError(EXIT_DAEMON_UNREACHABLE)`. Otherwise, fall back to
 *     `InProcTransport`. In verbose mode, log the reason to stderr.
 */

import { connectToSocket, defaultSocketPath, readCookie } from "@agent-profile/ipc-protocol";
import { CliError, EXIT_DAEMON_UNREACHABLE } from "../errors.js";
import { myClaudeHome } from "../utils/paths.js";
import { DaemonTransport } from "./daemon.js";
import { InProcTransport } from "./in-proc.js";
import type { CliTransport } from "./types.js";

/** Hard-coded CLI version sent in the IPC `hello` handshake. */
const CLI_HANDSHAKE_VERSION = "0.0.1";

/** Default budget for the daemon-attempt path. Keeps CLI startup snappy when nobody is home. */
const DEFAULT_DAEMON_ATTEMPT_TIMEOUT_MS = 1000;

/** Options for {@link getTransport}. */
export interface GetTransportOptions {
  /** Override myclaude home directory (cookie + sessions live here). */
  home?: string;
  /**
   * When true, exit 4 if the daemon is unreachable instead of falling back
   * to the in-process path. The `daemon status` and `daemon stop` commands
   * set this; data-load commands do not unless `--require-daemon` was passed.
   */
  requireDaemon?: boolean;
  /**
   * When true, skip the daemon-attempt entirely. Equivalent to setting
   * `MYCLAUDE_FORCE_STANDALONE=1`.
   */
  standalone?: boolean;
  /** Print a single line to stderr describing transport selection. */
  verbose?: boolean;
  /**
   * Override the per-attempt timeout. Defaults to
   * {@link DEFAULT_DAEMON_ATTEMPT_TIMEOUT_MS}.
   */
  attemptTimeoutMs?: number;
}

/**
 * Resolve the transport for one command invocation.
 *
 * @param opts - Selection knobs (home / require-daemon / standalone / verbose).
 * @returns A connected {@link CliTransport}. The caller MUST `await close()`.
 */
export async function getTransport(opts: GetTransportOptions = {}): Promise<CliTransport> {
  const home = opts.home ?? myClaudeHome();
  const verbose = Boolean(opts.verbose);

  if (opts.standalone || process.env.MYCLAUDE_FORCE_STANDALONE === "1") {
    if (opts.requireDaemon) {
      throw new CliError(
        "Cannot use --require-daemon with --standalone (or MYCLAUDE_FORCE_STANDALONE=1).",
        EXIT_DAEMON_UNREACHABLE
      );
    }
    if (verbose) {
      process.stderr.write("transport: standalone (forced)\n");
    }
    return new InProcTransport();
  }

  try {
    const cookie = await readCookie(home);
    const socketPath = defaultSocketPath();
    const client = await withTimeout(
      connectToSocket({
        socketPath,
        clientVersion: CLI_HANDSHAKE_VERSION,
        cookie,
      }),
      opts.attemptTimeoutMs ?? DEFAULT_DAEMON_ATTEMPT_TIMEOUT_MS,
      "daemon connect timed out"
    );
    if (verbose) {
      process.stderr.write(`transport: daemon (${socketPath})\n`);
    }
    return new DaemonTransport(client);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (opts.requireDaemon) {
      throw new CliError(
        `Daemon unreachable: ${reason}`,
        EXIT_DAEMON_UNREACHABLE,
        "Start it with `myclaude daemon start` (requires the desktop app to be built)."
      );
    }
    if (verbose) {
      process.stderr.write(`transport: standalone (daemon unreachable: ${reason})\n`);
    }
    return new InProcTransport();
  }
}

/**
 * Race a promise against a timeout, rejecting if it doesn't settle in time.
 * Used to bound the daemon-attempt path so the CLI doesn't hang on a stale
 * socket file.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export type { CliTransport } from "./types.js";
export { InProcTransport } from "./in-proc.js";
export { DaemonTransport } from "./daemon.js";

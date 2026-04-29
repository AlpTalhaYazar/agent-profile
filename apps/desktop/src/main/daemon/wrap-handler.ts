/**
 * @module daemon/wrap-handler
 *
 * Shared error-mapping wrapper for both read and write daemon handlers.
 *
 * Behavior:
 *
 *  - {@link ServiceError}: mapped to its IPC counterpart (`not-found` →
 *    `NOT_FOUND`, `io-error` → `INTERNAL`, otherwise `BAD_REQUEST`). The
 *    domain-shaped message is forwarded as-is.
 *  - {@link IpcError}: rethrown verbatim when `passthroughIpcError` is set
 *    (write-side handlers throw IpcError directly for domain failures and
 *    must reach the wire untouched).
 *  - Anything else: treated as an internal bug. The reason on the wire is a
 *    fixed string ("internal daemon error") so file paths / stack fragments
 *    never cross the IPC boundary; the real error is logged to stderr with
 *    the request kind for operator forensics.
 */

import { ServiceError } from "@agent-profile/cli-services";
import { type Handler, IpcError, type ReqT } from "@agent-profile/ipc-protocol";

/**
 * Wrap a typed handler so any thrown error is mapped to a corresponding
 * {@link IpcError}.
 *
 * Domain-shaped errors (`IpcError` raised by handlers, `ServiceError` raised
 * by cli-services) keep their original message because the message has been
 * curated for client display. Anything else is treated as an internal bug:
 * wire-side reason is the fixed string `"internal daemon error"`, with the
 * real message + stack written to stderr tagged with the request `kind`.
 *
 * @param kind - The request kind (e.g. `"auth.list"`). Surfaced in the stderr
 *   log line for non-domain throws so operators can correlate.
 * @param fn - The handler implementation.
 */
export function wrap<TReq>(
  kind: ReqT["kind"],
  fn: (req: TReq) => Promise<Record<string, unknown>>
): Handler {
  return async (req) => {
    try {
      return await fn(req as TReq);
    } catch (err) {
      if (err instanceof IpcError) throw err;
      if (err instanceof ServiceError) {
        const code =
          err.code === "not-found"
            ? "NOT_FOUND"
            : err.code === "io-error"
              ? "INTERNAL"
              : "BAD_REQUEST";
        throw new IpcError(code, err.message);
      }
      // Generic failure: keep wire-side reason opaque. Log internals to stderr.
      const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      process.stderr.write(`[agent-profile/daemon] internal error in ${kind}: ${detail}\n`);
      throw new IpcError("INTERNAL", "internal daemon error");
    }
  };
}

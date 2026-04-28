/**
 * @module @agent-profile/ipc-protocol/errors
 *
 * Shared error type for the IPC client and server.
 *
 * `IpcError` carries the `code` from a transport-level `error` response (or a
 * synthetic local one, e.g. when the connection drops mid-handshake) so
 * call-sites can switch on `err.code` without parsing message strings.
 */

import type { IpcErrorCode } from "./messages.js";

/**
 * Error thrown by the client when a request resolves to a transport-level
 * `error` response, or when local validation fails (e.g. cookie/version
 * mismatch detected before sending).
 *
 * The `code` field matches the closed enum in {@link ./messages.ts} plus the
 * special local-only codes used by the client when no server response was
 * received. Treat any unknown code as `INTERNAL`.
 */
export class IpcError extends Error {
  /** Transport-level error code; matches {@link IpcErrorCode} or a local code. */
  readonly code: IpcErrorCode | "TIMEOUT" | "DISCONNECTED";
  /** The request kind that triggered this error, when known. */
  readonly requestKind: string | undefined;

  constructor(
    code: IpcErrorCode | "TIMEOUT" | "DISCONNECTED",
    message: string,
    requestKind?: string
  ) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.requestKind = requestKind;
  }
}

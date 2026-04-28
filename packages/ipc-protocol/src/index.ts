/**
 * @module @agent-profile/ipc-protocol
 *
 * Typed wire format and transport primitives for the daemon ↔ CLI IPC channel.
 *
 * Three layers, importable separately:
 *
 *  - **Wire shapes** — `Req`, `Resp`, and per-kind Zod schemas in `messages.ts`.
 *  - **Transport** — `MessageDecoder` + `encodeMessage` (NDJSON) in `codec.ts`,
 *    plus `defaultSocketPath`, cookie helpers, and the handshake policy.
 *  - **Client/server** — promise-based `DaemonClient` and `DaemonServer` that
 *    glue the codec, schemas, and handshake into a complete request/response
 *    plumbing.
 *
 * The package has no Electron / app-specific dependencies; both `apps/cli` and
 * `apps/desktop` consume it. Peer-credential validation (`SO_PEERCRED` /
 * `LOCAL_PEEREID`) and process-lifecycle concerns belong in `apps/desktop`,
 * not here.
 */

// ─── Wire shapes ──────────────────────────────────────────────────────────────

export {
  Req,
  Resp,
  ReqHello,
  ReqAuthList,
  ReqAuthGetSecretRef,
  ReqProfileShow,
  ReqSessionsList,
  ReqDaemonStatus,
  ReqDaemonStop,
  RespHelloOk,
  RespAuthListOk,
  RespAuthGetSecretRefOk,
  RespProfileShowOk,
  RespSessionsListOk,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespError,
  type ReqT,
  type RespT,
  type ReqHelloT,
  type ReqAuthListT,
  type ReqAuthGetSecretRefT,
  type ReqProfileShowT,
  type ReqSessionsListT,
  type ReqDaemonStatusT,
  type ReqDaemonStopT,
  type RespHelloOkT,
  type RespAuthListOkT,
  type RespAuthGetSecretRefOkT,
  type RespProfileShowOkT,
  type RespSessionsListOkT,
  type RespDaemonStatusOkT,
  type RespDaemonStopOkT,
  type RespErrorT,
  type IpcErrorCode,
} from "./messages.js";

// ─── Codec ────────────────────────────────────────────────────────────────────

export {
  encodeMessage,
  MessageDecoder,
  MAX_LINE_BYTES,
  type MessageDecoderOptions,
} from "./codec.js";

// ─── Handshake policy ─────────────────────────────────────────────────────────

export {
  negotiateVersion,
  validateCookie,
  type VersionResult,
  type VersionOk,
  type VersionFail,
} from "./handshake.js";

// ─── Socket discovery ─────────────────────────────────────────────────────────

export { defaultSocketPath } from "./socket-path.js";

// ─── Cookie file helpers ──────────────────────────────────────────────────────

export { cookiePath, writeBootCookie, readCookie } from "./cookie.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export { IpcError } from "./errors.js";

// ─── Client ───────────────────────────────────────────────────────────────────

export {
  DaemonClient,
  connectToSocket,
  type DaemonClientOptions,
  type ConnectToSocketOptions,
  type RequestOptions,
  type ConnectResult,
} from "./client.js";

// ─── Server ───────────────────────────────────────────────────────────────────

export {
  DaemonServer,
  type DaemonServerOptions,
  type DrainOptions,
  type Handler,
  type HandlerMap,
  type HandlerContext,
} from "./server.js";

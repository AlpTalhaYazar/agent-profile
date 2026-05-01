/**
 * @module @agent-profile/ipc-protocol/messages
 *
 * Wire shapes for the daemon <-> CLI IPC protocol.
 *
 * The protocol is a bidirectional, newline-delimited JSON stream over a Unix
 * Domain Socket (POSIX) or Named Pipe (Windows). Every request/response frame
 * carries an `id` correlator and every frame carries a `kind` discriminant.
 *
 * Domain schemas live under `./messages/*`; this file is the stable facade for
 * existing imports.
 */

export {
  Evt,
  Frame,
  Req,
  Resp,
  type EvtT,
  type FrameT,
  type ReqT,
  type RespT,
} from "./messages/registry.js";
export * from "./messages/system.js";
export * from "./messages/auth.js";
export * from "./messages/profile.js";
export * from "./messages/sessions.js";
export * from "./messages/secrets.js";
export * from "./messages/persona.js";

/**
 * @module sessions/kill
 *
 * Pure validation service for `sessions.kill`.
 *
 * Killing a running session requires the daemon (the daemon owns the live
 * PID + capability bookkeeping); this service only validates the inputs and
 * normalises the optional signal selection. Callers route through the daemon
 * transport — the in-process transport raises `daemonRequired()` for kill.
 */
import { ServiceError } from "../errors.js";
import { assertValidSessionId } from "./registry.js";

/** Input options for `sessionsKillService`. */
export interface SessionsKillInput {
  /** Absolute path to the configured sessions root (e.g. `~/.myclaude/sessions`). */
  sessionsRoot: string;
  /** Session id to kill. Must pass {@link assertValidSessionId}. */
  sessionId: string;
  /** Optional signal selection. Daemon defaults to `SIGTERM`. */
  signal?: "SIGTERM" | "SIGKILL";
}

/** Validated payload ready to forward to the daemon. */
export interface SessionsKillResult {
  sessionId: string;
  signal?: "SIGTERM" | "SIGKILL";
}

/**
 * Validate a `sessions kill` invocation.
 *
 * @throws {ServiceError} `code: "config-invalid"` when `sessionId` is empty or
 *   contains characters outside the registry-id allowlist.
 */
export function sessionsKillService(input: SessionsKillInput): SessionsKillResult {
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    throw new ServiceError("config-invalid", "sessionId is required.");
  }
  assertValidSessionId(input.sessionId);
  const result: SessionsKillResult = { sessionId: input.sessionId };
  if (input.signal !== undefined) result.signal = input.signal;
  return result;
}

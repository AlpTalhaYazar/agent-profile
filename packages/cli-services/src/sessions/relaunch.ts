/**
 * @module sessions/relaunch
 *
 * Pure validation service for `sessions.relaunch`.
 *
 * Relaunching a session requires the daemon to mint a fresh capability token
 * and update its in-memory session map. There is no useful in-process
 * fallback; this service only validates inputs so the CLI rejects malformed
 * arguments before attempting to reach the daemon.
 */
import { ServiceError } from "../errors.js";
import { assertValidSessionId } from "./registry.js";

/** Input options for `sessionsRelaunchService`. */
export interface SessionsRelaunchInput {
  /** Absolute path to the configured sessions root (e.g. `~/.myclaude/sessions`). */
  sessionsRoot: string;
  /** Session id to relaunch. Must pass {@link assertValidSessionId}. */
  sessionId: string;
}

/** Validated payload ready to forward to the daemon. */
export interface SessionsRelaunchResult {
  sessionId: string;
}

/**
 * Validate a `sessions relaunch` invocation.
 *
 * @throws {ServiceError} `code: "config-invalid"` when `sessionId` is empty or
 *   contains characters outside the registry-id allowlist.
 */
export function sessionsRelaunchService(input: SessionsRelaunchInput): SessionsRelaunchResult {
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    throw new ServiceError("config-invalid", "sessionId is required.");
  }
  assertValidSessionId(input.sessionId);
  return { sessionId: input.sessionId };
}

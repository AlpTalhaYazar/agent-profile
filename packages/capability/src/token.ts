/**
 * @module @agent-profile/capability/token
 *
 * Capability-token primitives shared by the CLI, helper, and the forthcoming
 * Electron daemon.
 *
 * Two token shapes are supported:
 *
 *  - **Opaque random token** ({@link generateCapabilityToken}). A 32-byte
 *    base64url-encoded random string baked into the per-session
 *    `session.json` manifest. The helper compares it against the caller-supplied
 *    token with {@link timingSafeEqualString}.
 *  - **Signed token** ({@link signToken} / {@link verifyToken}). An
 *    HMAC-SHA-256 envelope `<base64url(payload)>.<base64url(mac)>` issued by
 *    the IPC daemon to processes it spawns. The payload binds a sessionId, the
 *    spawned PID, and an absolute expiry so a leaked token cannot be replayed
 *    by another process or after the session ends.
 *
 * Security notes:
 *  - All comparisons that touch a MAC are constant-time
 *    (`crypto.timingSafeEqual`).
 *  - Signing keys are raw 32-byte `Buffer`s — never base64url strings — so
 *    callers cannot accidentally expose them as opaque "tokens".
 *  - This module does not log; callers own all I/O.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Length in bytes of the random material backing both opaque tokens and signing keys. */
const TOKEN_BYTES = 32;

/** Length in bytes of an HMAC-SHA-256 digest (used by `verifyToken`'s constant-time compare). */
const HMAC_BYTES = 32;

/**
 * Payload encoded inside a signed capability token.
 *
 * `expiresAtMs` is an absolute Unix epoch in milliseconds, NOT a duration —
 * verifiers compare it against `Date.now()` (or `opts.now` for tests).
 */
export interface TokenPayload {
  /** Session identifier the token is bound to. */
  sessionId: string;
  /** Process id the token is bound to. */
  pid: number;
  /** Absolute Unix epoch (ms) at which the token stops verifying. */
  expiresAtMs: number;
}

/**
 * Result of {@link verifyToken} or {@link CapabilityVerifier.verify}.
 * Discriminated on `ok`.
 *
 * `"revoked"` is only ever produced by {@link CapabilityVerifier} (which
 * consults a {@link RevocationRegistry}); the standalone {@link verifyToken}
 * never emits it because it has no notion of revocation.
 */
export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | {
      ok: false;
      reason: "malformed" | "bad-signature" | "expired" | "revoked" | "unknown";
    };

/**
 * Generate the per-session bearer token used by helper wrappers.
 *
 * `randomBytes(32).toString("base64url")` yields 43 unpadded base64url chars.
 *
 * @returns A 43-char base64url string (no padding) backed by 32 random bytes.
 */
export function generateCapabilityToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Generate a fresh 32-byte HMAC-SHA-256 signing key for {@link signToken}.
 *
 * Returned as a raw `Buffer` so callers cannot accidentally treat the key as
 * an opaque token string. Persist via your platform secret store, not
 * `toString("base64url")` into a config file.
 *
 * @returns A 32-byte `Buffer` of cryptographic random material.
 */
export function generateSigningKey(): Buffer {
  return randomBytes(TOKEN_BYTES);
}

/**
 * Sign a {@link TokenPayload} into a `<base64url(payloadJson)>.<base64url(hmac)>` envelope.
 *
 * The MAC covers the *base64url-encoded* payload bytes, not the raw JSON, so
 * that verification can be done without re-serializing — the verifier only
 * needs to split on `.` and recompute the HMAC over the first half.
 *
 * @param payload - The session/PID/expiry tuple to bind into the token.
 * @param signingKey - 32-byte HMAC-SHA-256 key from {@link generateSigningKey}.
 * @returns A signed token string suitable for transport over IPC.
 */
export function signToken(payload: TokenPayload, signingKey: Buffer): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const mac = createHmac("sha256", signingKey).update(payloadB64).digest();
  const macB64 = mac.toString("base64url");
  return `${payloadB64}.${macB64}`;
}

/**
 * Verify a signed capability token produced by {@link signToken}.
 *
 * Verification order: structure → signature → expiry. Signature is checked
 * before the payload is parsed for the expiry check so a tampered payload
 * always fails as `bad-signature` rather than `malformed` or `expired`.
 *
 * @param token - The `<base64url(payload)>.<base64url(mac)>` envelope.
 * @param signingKey - The same 32-byte key that produced the token.
 * @param opts - Optional injected clock (`opts.now`, ms since epoch) for tests.
 * @returns A discriminated {@link VerifyResult}; never throws on bad input.
 */
export function verifyToken(
  token: string,
  signingKey: Buffer,
  opts?: { now?: number }
): VerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, macB64] = parts;
  if (!payloadB64 || !macB64) {
    return { ok: false, reason: "malformed" };
  }

  // Compute the expected MAC and compare in constant time. We compare digests
  // (fixed length) so `timingSafeEqual` cannot leak via length mismatch.
  const expectedMac = createHmac("sha256", signingKey).update(payloadB64).digest();
  let presentedMac: Buffer;
  try {
    presentedMac = Buffer.from(macB64, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (presentedMac.length !== HMAC_BYTES) {
    return { ok: false, reason: "bad-signature" };
  }
  if (!timingSafeEqual(expectedMac, presentedMac)) {
    return { ok: false, reason: "bad-signature" };
  }

  let payload: TokenPayload;
  try {
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(payloadJson);
    if (!isTokenPayload(parsed)) {
      return { ok: false, reason: "malformed" };
    }
    payload = parsed;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const now = opts?.now ?? Date.now();
  if (now > payload.expiresAtMs) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

/** Type guard: ensure a parsed JSON value matches the {@link TokenPayload} shape. */
function isTokenPayload(value: unknown): value is TokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.pid === "number" &&
    typeof candidate.expiresAtMs === "number"
  );
}

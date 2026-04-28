/**
 * @module @agent-profile/capability/verifier
 *
 * `CapabilityVerifier` checks tokens minted by {@link CapabilityIssuer}.
 * It runs three layers of validation in order:
 *
 *   1. Structural / signature / expiry — delegated to {@link verifyToken}.
 *   2. Revocation — checks the shared {@link RevocationRegistry}; a revoked
 *      `sessionId` rejects with `reason: "revoked"`.
 *
 * Verifiers never throw on bad input; every failure mode comes back as a
 * discriminated {@link VerifyResult}.
 */

import type { RevocationRegistry } from "./revocation.js";
import { type VerifyResult, verifyToken } from "./token.js";

/** Constructor options for {@link CapabilityVerifier}. */
export interface CapabilityVerifierOptions {
  /** 32-byte HMAC signing key — must match the issuer's. */
  signingKey: Buffer;
  /** Shared revocation registry — must be the same instance the issuer writes to. */
  revocations: RevocationRegistry;
  /** Wall-clock source; defaults to `Date.now`. */
  nowMs?: () => number;
}

/** Per-call options for {@link CapabilityVerifier.verify}. */
export interface VerifyOptions {
  /** Override the verifier's clock for this call only (tests). */
  now?: number;
}

/**
 * Capability-token verifier.
 *
 * Stateless apart from holding references to its signing key and shared
 * revocation registry. Multiple verifiers per process are fine.
 */
export class CapabilityVerifier {
  private readonly signingKey: Buffer;
  private readonly revocations: RevocationRegistry;
  private readonly now: () => number;

  constructor(opts: CapabilityVerifierOptions) {
    this.signingKey = opts.signingKey;
    this.revocations = opts.revocations;
    this.now = opts.nowMs ?? (() => Date.now());
  }

  /**
   * Verify a signed token.
   *
   * @returns A {@link VerifyResult}. On success the discriminated `payload`
   *   carries `{ sessionId, pid, expiresAtMs }`. Failure reasons:
   *   `"malformed"`, `"bad-signature"`, `"expired"`, `"revoked"`.
   */
  verify(token: string, opts: VerifyOptions = {}): VerifyResult {
    const now = opts.now ?? this.now();
    const inner = verifyToken(token, this.signingKey, { now });
    if (!inner.ok) return inner;
    if (this.revocations.isRevoked(inner.payload.sessionId)) {
      return { ok: false, reason: "revoked" };
    }
    return inner;
  }
}

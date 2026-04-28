/**
 * @module @agent-profile/capability/issuer
 *
 * `CapabilityIssuer` mints signed capability tokens for processes the daemon
 * spawns. Each token binds `{ sessionId, pid, expiresAtMs }` so a leaked token
 * cannot be replayed by another process or after the session ends.
 *
 * The signing key is generated once at construction (per daemon boot by
 * convention) and never persisted. Restarting the daemon invalidates every
 * previously-issued token automatically.
 *
 * Pair this with a {@link CapabilityVerifier} that shares the same signing
 * key and {@link RevocationRegistry} instance.
 */

import { RevocationRegistry } from "./revocation.js";
import { generateSigningKey, signToken } from "./token.js";

/** Minimum sensible TTL — guards against accidentally `ttlMs: 0` or negative. */
const MIN_TTL_MS = 1;

/** Constructor options for {@link CapabilityIssuer}. */
export interface CapabilityIssuerOptions {
  /**
   * 32-byte HMAC-SHA-256 signing key. Defaults to a fresh
   * {@link generateSigningKey} value. Pass an existing key when constructing a
   * paired {@link CapabilityVerifier} so issuer and verifier share state.
   */
  signingKey?: Buffer;
  /**
   * Shared revocation registry. Defaults to a new {@link RevocationRegistry}.
   * Tests that want to observe revocations may pass their own.
   */
  revocations?: RevocationRegistry;
  /**
   * Wall-clock source. Defaults to `Date.now`. Tests inject a controllable
   * clock to assert TTL semantics.
   */
  nowMs?: () => number;
}

/** Arguments for {@link CapabilityIssuer.issue}. */
export interface IssueArgs {
  /** Logical session identifier — non-empty. */
  sessionId: string;
  /** Pid the token is bound to (spawned process pid). */
  pid: number;
  /** Token lifetime in milliseconds; `expiresAtMs = now + ttlMs`. */
  ttlMs: number;
}

/** Result of {@link CapabilityIssuer.issue}. */
export interface IssuedToken {
  /** The signed token in `<base64url(payload)>.<base64url(mac)>` form. */
  token: string;
  /** Absolute Unix epoch (ms) at which the token stops verifying. */
  expiresAtMs: number;
}

/**
 * Capability-token issuer.
 *
 * Hold one per daemon process. The instance owns the signing key and writes
 * to the shared {@link RevocationRegistry} when sessions end.
 */
export class CapabilityIssuer {
  private readonly signingKey: Buffer;
  private readonly revocations: RevocationRegistry;
  private readonly now: () => number;

  constructor(opts: CapabilityIssuerOptions = {}) {
    this.signingKey = opts.signingKey ?? generateSigningKey();
    this.revocations = opts.revocations ?? new RevocationRegistry();
    this.now = opts.nowMs ?? (() => Date.now());
  }

  /**
   * Sign and return a fresh capability token.
   *
   * @throws if `sessionId` is empty, `pid` is negative, or `ttlMs < 1`.
   */
  issue(args: IssueArgs): IssuedToken {
    if (!args.sessionId || args.sessionId.length === 0) {
      throw new Error("CapabilityIssuer.issue: sessionId must be non-empty");
    }
    if (!Number.isFinite(args.pid) || args.pid < 0 || !Number.isInteger(args.pid)) {
      throw new Error(
        `CapabilityIssuer.issue: pid must be a non-negative integer (got ${args.pid})`
      );
    }
    if (!Number.isFinite(args.ttlMs) || args.ttlMs < MIN_TTL_MS) {
      throw new Error(`CapabilityIssuer.issue: ttlMs must be >= ${MIN_TTL_MS} (got ${args.ttlMs})`);
    }
    const expiresAtMs = this.now() + args.ttlMs;
    const token = signToken(
      { sessionId: args.sessionId, pid: args.pid, expiresAtMs },
      this.signingKey
    );
    return { token, expiresAtMs };
  }

  /**
   * Mark `sessionId` as revoked. Every existing token bearing this
   * `sessionId` will be rejected by any {@link CapabilityVerifier} sharing
   * the registry. Idempotent.
   */
  revokeSession(sessionId: string): void {
    this.revocations.revoke(sessionId, this.now());
  }

  /**
   * Drop every revocation entry. Called during daemon shutdown once all live
   * sessions have been ended.
   */
  revokeAll(): void {
    this.revocations.clear();
  }

  /**
   * @returns The signing key. Use to construct a paired
   * {@link CapabilityVerifier}; do not log, persist, or send over the wire.
   */
  getSigningKey(): Buffer {
    return this.signingKey;
  }

  /**
   * @returns The shared revocation registry. Useful when wiring a verifier
   * built around the same registry instance.
   */
  getRevocations(): RevocationRegistry {
    return this.revocations;
  }
}

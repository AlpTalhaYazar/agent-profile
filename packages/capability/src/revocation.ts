/**
 * @module @agent-profile/capability/revocation
 *
 * In-memory revocation registry for signed capability tokens.
 *
 * The registry tracks which session ids have been revoked. A
 * {@link CapabilityVerifier} consults the same registry the
 * {@link CapabilityIssuer} writes to; once a session is revoked, every token
 * bearing that `sessionId` is rejected forever — until the registry is
 * cleared (typically via daemon shutdown).
 *
 * Persistence is intentionally absent: the per-daemon-boot signing key in
 * {@link CapabilityIssuer} already invalidates every previously-issued token
 * when the daemon restarts, so a registry that survived restarts would only
 * track ghosts.
 */

/**
 * Revocation registry shared between an issuer and one or more verifiers.
 *
 * Construct one per daemon process and pass it to both
 * {@link CapabilityIssuer} and {@link CapabilityVerifier}. Methods are sync
 * because the data lives only in memory.
 */
export class RevocationRegistry {
  private readonly revokedAt: Map<string, number> = new Map();

  /**
   * Mark `sessionId` as revoked. Idempotent — re-revoking does not move the
   * stored timestamp. Tokens whose payload references this `sessionId` will be
   * rejected by any {@link CapabilityVerifier} sharing this registry.
   *
   * @param sessionId - The logical session identifier embedded in
   *   `TokenPayload.sessionId`.
   * @param nowMs - Optional revocation timestamp; defaults to `Date.now()`.
   *   Exposed for deterministic tests.
   */
  revoke(sessionId: string, nowMs: number = Date.now()): void {
    if (!this.revokedAt.has(sessionId)) {
      this.revokedAt.set(sessionId, nowMs);
    }
  }

  /**
   * @returns `true` iff `sessionId` has been revoked in this registry.
   */
  isRevoked(sessionId: string): boolean {
    return this.revokedAt.has(sessionId);
  }

  /**
   * Drop every revocation entry. Called by the daemon during graceful shutdown
   * once all live sessions have been ended; equivalent to throwing the
   * registry away and starting fresh on the next boot.
   */
  clear(): void {
    this.revokedAt.clear();
  }

  /** @returns The number of distinct revoked session ids currently tracked. */
  size(): number {
    return this.revokedAt.size;
  }

  /**
   * @internal
   * Return the timestamp at which `sessionId` was revoked, or `undefined` if
   * it is not revoked. Exposed for diagnostics / tests.
   */
  revokedAtMs(sessionId: string): number | undefined {
    return this.revokedAt.get(sessionId);
  }
}

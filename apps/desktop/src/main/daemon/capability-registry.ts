/**
 * @module daemon/capability-registry
 *
 * Single per-daemon-boot {@link CapabilityIssuer} + {@link CapabilityVerifier}
 * pair, sharing one {@link RevocationRegistry}. Wired into the lifecycle by
 * `apps/desktop/src/main/index.ts` after `app.whenReady()`.
 *
 * The signing key is generated on construction and never persisted, so a
 * daemon restart automatically invalidates every previously-issued token.
 */

import {
  CapabilityIssuer,
  CapabilityVerifier,
  RevocationRegistry,
  generateSigningKey,
} from "@agent-profile/capability";

/** Bundle returned by {@link buildCapabilityRegistry}. */
export interface CapabilityRegistry {
  issuer: CapabilityIssuer;
  verifier: CapabilityVerifier;
  revocations: RevocationRegistry;
}

/**
 * Construct the per-boot capability primitives. Pass an explicit `nowMs`
 * factory in tests to make TTLs deterministic.
 */
export function buildCapabilityRegistry(opts: { nowMs?: () => number } = {}): CapabilityRegistry {
  const signingKey = generateSigningKey();
  const revocations = new RevocationRegistry();
  const issuer = new CapabilityIssuer({
    signingKey,
    revocations,
    ...(opts.nowMs ? { nowMs: opts.nowMs } : {}),
  });
  const verifier = new CapabilityVerifier({
    signingKey,
    revocations,
    ...(opts.nowMs ? { nowMs: opts.nowMs } : {}),
  });
  return { issuer, verifier, revocations };
}

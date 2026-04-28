/**
 * Tests for {@link CapabilityVerifier}.
 */

import { describe, expect, it } from "vitest";
import { CapabilityIssuer } from "../src/issuer.js";
import { RevocationRegistry } from "../src/revocation.js";
import { generateSigningKey, signToken } from "../src/token.js";
import { CapabilityVerifier } from "../src/verifier.js";

function pair(nowMs?: () => number) {
  const key = generateSigningKey();
  const reg = new RevocationRegistry();
  const issuer = new CapabilityIssuer({
    signingKey: key,
    revocations: reg,
    ...(nowMs ? { nowMs } : {}),
  });
  const verifier = new CapabilityVerifier({
    signingKey: key,
    revocations: reg,
    ...(nowMs ? { nowMs } : {}),
  });
  return { key, reg, issuer, verifier };
}

describe("CapabilityVerifier", () => {
  it("accepts a freshly issued token", () => {
    const { issuer, verifier } = pair(() => 1000);
    const { token } = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 60_000 });
    const r = verifier.verify(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.sessionId).toBe("s");
      expect(r.payload.pid).toBe(1);
      expect(r.payload.expiresAtMs).toBe(61_000);
    }
  });

  it("rejects an expired token as expired", () => {
    const { issuer, verifier } = pair(() => 1000);
    const { token } = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 100 });
    const r = verifier.verify(token, { now: 5000 });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token signed with a different key", () => {
    const otherKey = generateSigningKey();
    const { verifier } = pair(() => 1000);
    const fake = signToken({ sessionId: "s", pid: 1, expiresAtMs: 5000 }, otherKey);
    const r = verifier.verify(fake, { now: 1000 });
    expect(r).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a malformed token", () => {
    const { verifier } = pair();
    expect(verifier.verify("garbage")).toEqual({ ok: false, reason: "malformed" });
    expect(verifier.verify("")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a revoked sessionId with reason 'revoked'", () => {
    const { issuer, verifier } = pair(() => 1000);
    const { token } = issuer.issue({ sessionId: "to-revoke", pid: 1, ttlMs: 60_000 });
    issuer.revokeSession("to-revoke");
    const r = verifier.verify(token, { now: 1500 });
    expect(r).toEqual({ ok: false, reason: "revoked" });
  });

  it("revocation does not affect a different sessionId", () => {
    const { issuer, verifier } = pair(() => 1000);
    const a = issuer.issue({ sessionId: "alive", pid: 1, ttlMs: 60_000 });
    const b = issuer.issue({ sessionId: "doomed", pid: 2, ttlMs: 60_000 });
    issuer.revokeSession("doomed");
    const ra = verifier.verify(a.token, { now: 1500 });
    const rb = verifier.verify(b.token, { now: 1500 });
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.reason).toBe("revoked");
  });

  it("revokeAll un-revokes nothing — any new revoke after clear takes effect", () => {
    const { issuer, verifier } = pair(() => 1000);
    const { token } = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 60_000 });
    issuer.revokeSession("s");
    expect(verifier.verify(token, { now: 1500 }).ok).toBe(false);
    issuer.revokeAll();
    expect(verifier.verify(token, { now: 1500 }).ok).toBe(true);
    issuer.revokeSession("s");
    expect(verifier.verify(token, { now: 1500 }).ok).toBe(false);
  });

  it("expired-and-revoked token reports 'expired' (signature/expiry checked first)", () => {
    const { issuer, verifier } = pair(() => 1000);
    const { token } = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 100 });
    issuer.revokeSession("s");
    const r = verifier.verify(token, { now: 5000 });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("uses the verifier's clock when no per-call now is provided", () => {
    let clock = 1000;
    const { issuer, verifier } = pair(() => clock);
    const { token } = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 1000 });
    expect(verifier.verify(token).ok).toBe(true);
    clock = 5000;
    expect(verifier.verify(token).ok).toBe(false);
  });
});

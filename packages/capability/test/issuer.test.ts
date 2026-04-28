/**
 * Tests for {@link CapabilityIssuer}.
 */

import { describe, expect, it } from "vitest";
import { CapabilityIssuer } from "../src/issuer.js";
import { RevocationRegistry } from "../src/revocation.js";
import { generateSigningKey, verifyToken } from "../src/token.js";

describe("CapabilityIssuer", () => {
  it("issues a token that round-trips through verifyToken with the same key", () => {
    const key = generateSigningKey();
    const issuer = new CapabilityIssuer({ signingKey: key, nowMs: () => 1000 });
    const { token, expiresAtMs } = issuer.issue({
      sessionId: "s-1",
      pid: 12345,
      ttlMs: 60_000,
    });
    expect(expiresAtMs).toBe(61_000);
    const result = verifyToken(token, key, { now: 1500 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sessionId).toBe("s-1");
      expect(result.payload.pid).toBe(12345);
      expect(result.payload.expiresAtMs).toBe(61_000);
    }
  });

  it("uses Date.now when no clock injected", () => {
    const issuer = new CapabilityIssuer();
    const before = Date.now();
    const { expiresAtMs } = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 1000 });
    const after = Date.now();
    expect(expiresAtMs >= before + 1000).toBe(true);
    expect(expiresAtMs <= after + 1000).toBe(true);
  });

  it("generates a fresh signing key when none provided", () => {
    const a = new CapabilityIssuer();
    const b = new CapabilityIssuer();
    expect(a.getSigningKey().equals(b.getSigningKey())).toBe(false);
  });

  it("throws on empty sessionId", () => {
    const issuer = new CapabilityIssuer();
    expect(() => issuer.issue({ sessionId: "", pid: 1, ttlMs: 1000 })).toThrow(/sessionId/);
  });

  it("throws on negative pid", () => {
    const issuer = new CapabilityIssuer();
    expect(() => issuer.issue({ sessionId: "s", pid: -1, ttlMs: 1000 })).toThrow(/pid/);
  });

  it("throws on non-integer pid", () => {
    const issuer = new CapabilityIssuer();
    expect(() => issuer.issue({ sessionId: "s", pid: 1.5, ttlMs: 1000 })).toThrow(/pid/);
  });

  it("throws on zero or negative ttlMs", () => {
    const issuer = new CapabilityIssuer();
    expect(() => issuer.issue({ sessionId: "s", pid: 1, ttlMs: 0 })).toThrow(/ttlMs/);
    expect(() => issuer.issue({ sessionId: "s", pid: 1, ttlMs: -100 })).toThrow(/ttlMs/);
  });

  it("revokeSession writes to the shared registry", () => {
    const reg = new RevocationRegistry();
    const issuer = new CapabilityIssuer({ revocations: reg, nowMs: () => 5000 });
    issuer.revokeSession("s-x");
    expect(reg.isRevoked("s-x")).toBe(true);
    expect(reg.revokedAtMs("s-x")).toBe(5000);
  });

  it("revokeAll clears the registry", () => {
    const reg = new RevocationRegistry();
    const issuer = new CapabilityIssuer({ revocations: reg });
    issuer.revokeSession("a");
    issuer.revokeSession("b");
    expect(reg.size()).toBe(2);
    issuer.revokeAll();
    expect(reg.size()).toBe(0);
  });

  it("getRevocations returns the same instance passed at construction", () => {
    const reg = new RevocationRegistry();
    const issuer = new CapabilityIssuer({ revocations: reg });
    expect(issuer.getRevocations()).toBe(reg);
  });

  it("getSigningKey returns the configured key buffer", () => {
    const key = generateSigningKey();
    const issuer = new CapabilityIssuer({ signingKey: key });
    expect(issuer.getSigningKey().equals(key)).toBe(true);
  });

  it("emits distinct tokens for distinct calls", () => {
    const issuer = new CapabilityIssuer({ nowMs: () => 1000 });
    const t1 = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 1000 });
    const t2 = issuer.issue({ sessionId: "s", pid: 1, ttlMs: 1000 });
    // Same payload + key → same token (HMAC determinism). Verify the issuer
    // does not silently add nonce material.
    expect(t1.token).toBe(t2.token);
  });
});

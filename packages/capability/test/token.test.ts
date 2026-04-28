/**
 * Tests for capability-token generation, HMAC signing, and verification.
 */

import { describe, expect, it } from "vitest";
import {
  generateCapabilityToken,
  generateSigningKey,
  signToken,
  verifyToken,
} from "../src/token.js";

describe("generateCapabilityToken", () => {
  it("returns a 43-char base64url string with no padding", () => {
    const token = generateCapabilityToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("=");
  });

  it("produces a different token on each call", () => {
    expect(generateCapabilityToken()).not.toBe(generateCapabilityToken());
  });
});

describe("generateSigningKey", () => {
  it("returns a 32-byte Buffer", () => {
    const key = generateSigningKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });
});

describe("signToken / verifyToken", () => {
  const payload = {
    sessionId: "session-abc",
    pid: 12345,
    expiresAtMs: Date.now() + 60_000,
  };

  it("round-trips with the correct signing key", () => {
    const key = generateSigningKey();
    const token = signToken(payload, key);
    const result = verifyToken(token, key);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
    }
  });

  it("preserves the sessionId through round-trip", () => {
    const key = generateSigningKey();
    const token = signToken({ ...payload, sessionId: "another-session-id" }, key);
    const result = verifyToken(token, key);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sessionId).toBe("another-session-id");
    }
  });

  it("rejects a token signed with a different key as bad-signature", () => {
    const issuerKey = generateSigningKey();
    const verifierKey = generateSigningKey();
    const token = signToken(payload, issuerKey);
    const result = verifyToken(token, verifierKey);
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects an expired token as expired", () => {
    const key = generateSigningKey();
    const expiredPayload = { ...payload, expiresAtMs: 1_000 };
    const token = signToken(expiredPayload, key);
    const result = verifyToken(token, key, { now: 2_000 });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered payload as bad-signature", () => {
    const key = generateSigningKey();
    const token = signToken(payload, key);
    const [, mac] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...payload, sessionId: "evil" }),
      "utf8"
    ).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${mac}`;
    const result = verifyToken(tamperedToken, key);
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a malformed token (not two parts)", () => {
    const key = generateSigningKey();
    expect(verifyToken("only-one-part", key)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyToken("a.b.c", key)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyToken("", key)).toEqual({ ok: false, reason: "malformed" });
  });
});

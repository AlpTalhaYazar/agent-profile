/**
 * Tests for {@link RevocationRegistry}.
 */

import { describe, expect, it } from "vitest";
import { RevocationRegistry } from "../src/revocation.js";

describe("RevocationRegistry", () => {
  it("starts empty", () => {
    const r = new RevocationRegistry();
    expect(r.size()).toBe(0);
    expect(r.isRevoked("s-1")).toBe(false);
  });

  it("revoke marks the sessionId", () => {
    const r = new RevocationRegistry();
    r.revoke("s-1", 1000);
    expect(r.isRevoked("s-1")).toBe(true);
    expect(r.revokedAtMs("s-1")).toBe(1000);
    expect(r.size()).toBe(1);
  });

  it("revoke is idempotent — second call does not advance the timestamp", () => {
    const r = new RevocationRegistry();
    r.revoke("s-1", 1000);
    r.revoke("s-1", 2000);
    expect(r.revokedAtMs("s-1")).toBe(1000);
    expect(r.size()).toBe(1);
  });

  it("isRevoked returns false for unknown sessionIds", () => {
    const r = new RevocationRegistry();
    r.revoke("s-1", 1000);
    expect(r.isRevoked("s-2")).toBe(false);
  });

  it("clear empties the registry", () => {
    const r = new RevocationRegistry();
    r.revoke("a");
    r.revoke("b");
    r.revoke("c");
    expect(r.size()).toBe(3);
    r.clear();
    expect(r.size()).toBe(0);
    expect(r.isRevoked("a")).toBe(false);
  });

  it("revokedAtMs returns undefined for unknown sessionId", () => {
    const r = new RevocationRegistry();
    expect(r.revokedAtMs("never")).toBeUndefined();
  });

  it("revoke without explicit timestamp uses Date.now", () => {
    const r = new RevocationRegistry();
    const before = Date.now();
    r.revoke("s");
    const after = Date.now();
    const stored = r.revokedAtMs("s") ?? Number.NaN;
    expect(stored >= before).toBe(true);
    expect(stored <= after).toBe(true);
  });
});

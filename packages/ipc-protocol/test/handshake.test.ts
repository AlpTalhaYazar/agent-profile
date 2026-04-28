import { describe, expect, it } from "vitest";
import { negotiateVersion, validateCookie } from "../src/handshake.js";

describe("negotiateVersion", () => {
  it("accepts identical versions", () => {
    expect(negotiateVersion("0.1.0", "0.1.0")).toEqual({ ok: true });
  });

  it("accepts different minors with the same major", () => {
    expect(negotiateVersion("0.1.0", "0.2.5")).toEqual({ ok: true });
  });

  it("rejects different majors", () => {
    expect(negotiateVersion("0.1.0", "1.0.0")).toEqual({
      ok: false,
      reason: "incompatible-major",
    });
  });

  it("rejects malformed versions", () => {
    expect(negotiateVersion("", "0.1.0")).toEqual({
      ok: false,
      reason: "incompatible-major",
    });
    expect(negotiateVersion("not-a-version", "0.1.0")).toEqual({
      ok: false,
      reason: "incompatible-major",
    });
  });
});

describe("validateCookie", () => {
  it("accepts identical cookies", () => {
    expect(validateCookie("abc123", "abc123")).toBe(true);
  });
  it("rejects mismatched cookies", () => {
    expect(validateCookie("abc123", "xyz789")).toBe(false);
  });
  it("rejects cookies with different lengths", () => {
    expect(validateCookie("short", "longer-cookie-value")).toBe(false);
  });
});

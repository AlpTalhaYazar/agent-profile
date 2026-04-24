/**
 * Tests for the constant-time capability-token comparator.
 */

import { describe, expect, it } from "vitest";
import { timingSafeEqualString } from "../../src/client/capability.js";

describe("timingSafeEqualString", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualString("abc-123", "abc-123")).toBe(true);
  });

  it("returns true for empty strings on both sides", () => {
    expect(timingSafeEqualString("", "")).toBe(true);
  });

  it("returns false when the strings differ by a single byte", () => {
    expect(timingSafeEqualString("abc-123", "abc-124")).toBe(false);
  });

  it("returns false when the strings differ in length (short vs long)", () => {
    expect(timingSafeEqualString("short", "shortlonger")).toBe(false);
  });

  it("returns false when the strings differ in length (long vs short)", () => {
    expect(timingSafeEqualString("shortlonger", "short")).toBe(false);
  });

  it("returns false when one side is empty", () => {
    expect(timingSafeEqualString("", "non-empty")).toBe(false);
    expect(timingSafeEqualString("non-empty", "")).toBe(false);
  });

  it("handles UTF-8 consistently", () => {
    expect(timingSafeEqualString("café", "café")).toBe(true);
    expect(timingSafeEqualString("café", "cafe")).toBe(false);
  });
});

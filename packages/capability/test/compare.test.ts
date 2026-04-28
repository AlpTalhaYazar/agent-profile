/**
 * Tests for the constant-time capability-token comparator.
 */

import { describe, expect, it } from "vitest";
import { timingSafeEqualString } from "../src/compare.js";

describe("timingSafeEqualString", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualString("abc-123", "abc-123")).toBe(true);
  });

  it("returns false when the strings differ by a single byte", () => {
    expect(timingSafeEqualString("abc-123", "abc-124")).toBe(false);
  });

  it("returns false when the strings differ in length", () => {
    expect(timingSafeEqualString("short", "shortlonger")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqualString("", "")).toBe(true);
  });

  it("returns true for byte-equal unicode strings", () => {
    expect(timingSafeEqualString("café", "café")).toBe(true);
  });
});

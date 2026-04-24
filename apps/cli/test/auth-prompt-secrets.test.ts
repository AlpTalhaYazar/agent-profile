/**
 * Tests for `auth/prompt-secrets.ts`.
 * Only covers the non-interactive paths (isTTY detection, readStdin).
 * The consola prompt functions require a real TTY and are not unit-tested here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTTY, readStdin } from "../src/auth/prompt-secrets.js";

describe("isTTY", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env to original state.
    process.env.CI = origEnv.CI;
    process.env.NO_TTY = origEnv.NO_TTY;
    vi.restoreAllMocks();
  });

  it("returns false when CI=1", () => {
    process.env.CI = "1";
    expect(isTTY()).toBe(false);
  });

  it("returns false when NO_TTY=1", () => {
    process.env.CI = undefined;
    process.env.NO_TTY = "1";
    expect(isTTY()).toBe(false);
  });

  it("returns false when stdin.isTTY is falsy (non-interactive vitest context)", () => {
    process.env.CI = undefined;
    process.env.NO_TTY = undefined;
    // In vitest (non-interactive), process.stdin.isTTY is undefined which is falsy.
    // Save and restore the original value.
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      expect(isTTY()).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });

  it("returns true when stdin.isTTY is true and CI/NO_TTY are unset", () => {
    process.env.CI = undefined;
    process.env.NO_TTY = undefined;
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      expect(isTTY()).toBe(true);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });
});

describe("readStdin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with trimmed input from stdin data events", async () => {
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "on").mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "data") handler("  secret-value\n");
        if (event === "end") handler();
        return process.stdin;
      }
    );

    const result = await readStdin();
    expect(result).toBe("secret-value");
  });

  it("rejects on stdin error", async () => {
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "on").mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "error") handler(new Error("stdin read error"));
        return process.stdin;
      }
    );

    await expect(readStdin()).rejects.toThrow("stdin read error");
  });
});

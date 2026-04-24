/**
 * Tests for `output/redact.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  REDACTED,
  applyRedaction,
  isSensitiveField,
  redactRecord,
  unresolvedMarker,
} from "../src/output/redact.js";

describe("isSensitiveField", () => {
  it("returns true for keyring:// refs", () => {
    expect(isSensitiveField("keyring://anthropic/work")).toBe(true);
    expect(isSensitiveField("prefix keyring://github/work suffix")).toBe(true);
  });

  it("returns true for ${secret:...} refs", () => {
    expect(isSensitiveField("${secret:github.pat}")).toBe(true);
    expect(isSensitiveField("Bearer ${secret:api.token}")).toBe(true);
  });

  it("returns false for ${env:...} refs", () => {
    expect(isSensitiveField("${env:HOME}")).toBe(false);
    expect(isSensitiveField("${env:PATH}/bin")).toBe(false);
  });

  it("returns false for plain strings", () => {
    expect(isSensitiveField("nvim")).toBe(false);
    expect(isSensitiveField("https://example.com")).toBe(false);
    expect(isSensitiveField("")).toBe(false);
  });
});

describe("applyRedaction", () => {
  it("returns REDACTED for sensitive fields when showValues is false", () => {
    const result = applyRedaction("${secret:github.pat}", "ghp_actual_token", false);
    expect(result).toBe(REDACTED);
    expect(result).not.toContain("ghp_actual_token");
  });

  it("returns actual value when showValues is true", () => {
    const result = applyRedaction("${secret:github.pat}", "ghp_actual_token", true);
    expect(result).toBe("ghp_actual_token");
  });

  it("does not redact ${env:} substitutions", () => {
    const result = applyRedaction("${env:HOME}", "/home/user", false);
    expect(result).toBe("/home/user");
  });

  it("does not redact plain values", () => {
    const result = applyRedaction("nvim", "nvim", false);
    expect(result).toBe("nvim");
  });

  it("redacts keyring:// refs when showValues is false", () => {
    const result = applyRedaction("keyring://anthropic/work", "sk-ant-actual", false);
    expect(result).toBe(REDACTED);
    expect(result).not.toContain("sk-ant-actual");
  });
});

describe("unresolvedMarker", () => {
  it("formats an unresolved ref", () => {
    const marker = unresolvedMarker("${secret:github.pat}");
    expect(marker).toContain("unresolved");
    expect(marker).toContain("${secret:github.pat}");
  });

  it("formats a keyring URI ref", () => {
    const marker = unresolvedMarker("keyring://anthropic/work");
    expect(marker).toContain("keyring://anthropic/work");
  });
});

describe("redactRecord", () => {
  it("redacts sensitive fields in a record", () => {
    const original = {
      TOKEN: "${secret:github.pat}",
      PATH: "${env:PATH}",
      NAME: "Alice",
    };
    const resolved = {
      TOKEN: "ghp_real_token",
      PATH: "/usr/bin",
      NAME: "Alice",
    };

    const result = redactRecord(original, resolved, false);
    expect(result.TOKEN).toBe(REDACTED);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.NAME).toBe("Alice");
  });

  it("shows actual values when showValues is true", () => {
    const original = {
      TOKEN: "${secret:github.pat}",
    };
    const resolved = {
      TOKEN: "ghp_real_token",
    };

    const result = redactRecord(original, resolved, true);
    expect(result.TOKEN).toBe("ghp_real_token");
  });
});

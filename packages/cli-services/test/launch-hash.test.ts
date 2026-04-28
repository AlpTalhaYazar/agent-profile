import { describe, expect, it } from "vitest";
import { computeLaunchHash } from "../src/launch-hash.js";

describe("computeLaunchHash", () => {
  const baseInput = {
    effective: { mcp: { servers: { fs: { command: "node" } } }, env: { EDITOR: "vim" } },
    provenance: { scopes: ["global", "project"] },
    scopeFiles: ["/home/u/.myclaude/global/shared.yml", "/repo/.myclaude/role.yml"] as const,
  };

  it("returns a 64-char hex digest", () => {
    const hash = computeLaunchHash(baseInput);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", () => {
    const a = computeLaunchHash(baseInput);
    const b = computeLaunchHash({ ...baseInput });
    expect(a).toBe(b);
  });

  it("is stable across object key ordering", () => {
    const reordered = {
      effective: {
        env: { EDITOR: "vim" },
        mcp: { servers: { fs: { command: "node" } } },
      },
      provenance: { scopes: ["global", "project"] },
      scopeFiles: baseInput.scopeFiles,
    };
    expect(computeLaunchHash(reordered)).toBe(computeLaunchHash(baseInput));
  });

  it("changes when any nested value changes", () => {
    const drifted = {
      ...baseInput,
      effective: { ...baseInput.effective, env: { EDITOR: "nano" } },
    };
    expect(computeLaunchHash(drifted)).not.toBe(computeLaunchHash(baseInput));
  });

  it("changes when scopeFiles ordering changes", () => {
    const reorderedScopes = {
      ...baseInput,
      scopeFiles: [...baseInput.scopeFiles].reverse(),
    };
    expect(computeLaunchHash(reorderedScopes)).not.toBe(computeLaunchHash(baseInput));
  });

  it("treats arrays as significant (insertion vs deletion)", () => {
    const removed = { ...baseInput, scopeFiles: [baseInput.scopeFiles[0]] };
    expect(computeLaunchHash(removed)).not.toBe(computeLaunchHash(baseInput));
  });

  it("handles empty inputs without throwing", () => {
    const empty = computeLaunchHash({ effective: {}, provenance: {}, scopeFiles: [] });
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
  });
});

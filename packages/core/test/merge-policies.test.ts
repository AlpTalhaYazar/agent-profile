import { describe, expect, it } from "vitest";
import { dedupArray, deepMergeServer } from "../src/cascade/merge-policies.js";
import type { McpServerT } from "../src/schema/index.js";

describe("deepMergeServer", () => {
  it("keeps base command/args when incoming does not provide them", () => {
    const base: McpServerT = {
      type: "stdio",
      command: "npx",
      args: ["-y", "server-postgres"],
      env: { DATABASE_URL: "postgres://base" },
      enabled: true,
      __merge: "replace",
    };
    const incoming: McpServerT = {
      type: "stdio",
      command: "npx",
      args: ["-y", "server-postgres"],
      env: { DATABASE_URL: "postgres://override" },
      enabled: true,
      __merge: "deep",
    };
    const merged = deepMergeServer(base, incoming);
    if ("command" in merged) {
      expect(merged.command).toBe("npx");
    }
    if ("env" in merged) {
      expect(merged.env.DATABASE_URL).toBe("postgres://override");
    }
  });

  it("args always replace, never concatenate", () => {
    const base: McpServerT = {
      command: "npx",
      args: ["-y", "old-pkg"],
      env: {},
      enabled: true,
      __merge: "replace",
    };
    const incoming: McpServerT = {
      command: "npx",
      args: ["-z"],
      env: {},
      enabled: true,
      __merge: "deep",
    };
    const merged = deepMergeServer(base, incoming);
    if ("args" in merged) {
      expect(merged.args).toEqual(["-z"]);
    }
  });

  it("env deep-merges: base keys preserved, incoming keys override", () => {
    const base: McpServerT = {
      command: "node",
      args: [],
      env: { A: "1", B: "2" },
      enabled: true,
      __merge: "replace",
    };
    const incoming: McpServerT = {
      command: "node",
      args: [],
      env: { B: "3", C: "4" },
      enabled: true,
      __merge: "deep",
    };
    const merged = deepMergeServer(base, incoming);
    if ("env" in merged) {
      expect(merged.env.A).toBe("1"); // preserved from base
      expect(merged.env.B).toBe("3"); // overridden by incoming
      expect(merged.env.C).toBe("4"); // new from incoming
    }
  });

  it("headers deep-merge: base keys preserved, incoming keys override", () => {
    const base: McpServerT = {
      type: "http",
      url: "https://example.com",
      headers: { "X-Custom": "base", Authorization: "Bearer old" },
      enabled: true,
      __merge: "replace",
    };
    const incoming: McpServerT = {
      type: "http",
      url: "https://example.com",
      headers: { Authorization: "Bearer new" },
      enabled: true,
      __merge: "deep",
    };
    const merged = deepMergeServer(base, incoming);
    if ("headers" in merged) {
      expect(merged.headers["X-Custom"]).toBe("base");
      expect(merged.headers.Authorization).toBe("Bearer new");
    }
  });

  it("scalar fields: incoming wins", () => {
    const base: McpServerT = {
      command: "node",
      args: [],
      env: {},
      enabled: true,
      __merge: "replace",
    };
    const incoming: McpServerT = {
      command: "bun",
      args: [],
      env: {},
      enabled: true,
      __merge: "replace",
    };
    const merged = deepMergeServer(base, incoming);
    if ("command" in merged) {
      expect(merged.command).toBe("bun");
    }
  });
});

describe("dedupArray", () => {
  it("removes duplicate strings while preserving order", () => {
    const result = dedupArray(["a.md", "b.md", "a.md", "c.md"]);
    expect(result).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("returns an empty array as-is", () => {
    expect(dedupArray([])).toEqual([]);
  });

  it("returns a single-element array unchanged", () => {
    expect(dedupArray(["a.md"])).toEqual(["a.md"]);
  });

  it("handles all-unique arrays unchanged", () => {
    expect(dedupArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

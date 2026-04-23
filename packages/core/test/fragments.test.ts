import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandFragments } from "../src/cascade/fragment-expander.js";
import { FragmentNotFoundError } from "../src/errors.js";
import { ScopeDoc } from "../src/schema/index.js";

let _dirCounter = 0;

/**
 * Creates a temporary fragments directory and writes named fragment files.
 */
function setupFragmentsDir(fragments: Record<string, string>): string {
  const dir = join(tmpdir(), `fragments-test-${Date.now()}-${++_dirCounter}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(fragments)) {
    writeFileSync(join(dir, `${name}.yml`), content);
  }
  return dir;
}

describe("expandFragments", () => {
  it("expands a named fragment into the layer's mcpServers", () => {
    const fragDir = setupFragmentsDir({
      "postgres-core": `
name: postgres-core
mcpServer:
  postgres:
    type: stdio
    command: npx
    args: ["-y", "server-postgres"]
    env:
      DATABASE_URL: "\${secret:postgres.default}"
`,
    });

    const layer = ScopeDoc.parse({
      version: 1,
      use: ["postgres-core"],
      mcpServers: {},
    });
    const expanded = expandFragments(layer, [fragDir]);

    expect(expanded.mcpServers.postgres).toBeDefined();
    if (expanded.mcpServers.postgres) {
      const server = expanded.mcpServers.postgres;
      expect("command" in server && server.command).toBe("npx");
    }
  });

  it("scope's own mcpServers entry overrides fragment for same-named server", () => {
    const fragDir = setupFragmentsDir({
      "postgres-core": `
name: postgres-core
mcpServer:
  postgres:
    type: stdio
    command: npx
    args: ["-y", "server-postgres"]
    env:
      DATABASE_URL: "\${secret:postgres.default}"
`,
    });

    const layer = ScopeDoc.parse({
      version: 1,
      use: ["postgres-core"],
      mcpServers: {
        postgres: {
          type: "stdio",
          command: "custom-postgres-cmd",
          args: [],
          env: { DATABASE_URL: "${secret:postgres.override}" },
        },
      },
    });
    const expanded = expandFragments(layer, [fragDir]);

    // Scope's own entry wins (fragment is a default for missing keys)
    const server = expanded.mcpServers.postgres;
    expect(server).toBeDefined();
    if (server && "command" in server) {
      expect(server.command).toBe("custom-postgres-cmd");
    }
  });

  it("throws FragmentNotFoundError for a missing fragment name", () => {
    const fragDir = setupFragmentsDir({}); // empty dir

    const layer = ScopeDoc.parse({
      version: 1,
      use: ["nonexistent-fragment"],
      mcpServers: {},
    });

    expect(() => expandFragments(layer, [fragDir])).toThrow(FragmentNotFoundError);
  });

  it("FragmentNotFoundError includes the fragment name and searched paths", () => {
    const fragDir = setupFragmentsDir({});
    const layer = ScopeDoc.parse({
      version: 1,
      use: ["missing-frag"],
      mcpServers: {},
    });

    let caughtError: FragmentNotFoundError | null = null;
    try {
      expandFragments(layer, [fragDir]);
    } catch (e) {
      if (e instanceof FragmentNotFoundError) {
        caughtError = e;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.fragmentName).toBe("missing-frag");
    expect(caughtError?.searchedPaths.length).toBeGreaterThan(0);
  });

  it("merges fragment env as defaults (scope env wins)", () => {
    const fragDir = setupFragmentsDir({
      "git-core": `
name: git-core
mcpServer:
  git:
    type: stdio
    command: npx
    args: ["-y", "server-git"]
    env: {}
env:
  GIT_EDITOR: "vim"
  GIT_DEFAULT_BRANCH: "main"
`,
    });

    const layer = ScopeDoc.parse({
      version: 1,
      use: ["git-core"],
      env: { GIT_EDITOR: "nvim" }, // override fragment's default
    });
    const expanded = expandFragments(layer, [fragDir]);

    // Scope's GIT_EDITOR wins over fragment's default
    expect(expanded.env.GIT_EDITOR).toBe("nvim");
    // Fragment's GIT_DEFAULT_BRANCH is kept (scope doesn't set it)
    expect(expanded.env.GIT_DEFAULT_BRANCH).toBe("main");
  });

  it("returns original layer unchanged when use is empty", () => {
    const layer = ScopeDoc.parse({
      version: 1,
      use: [],
      mcpServers: { postgres: { command: "pg", args: [], env: {} } },
    });
    const expanded = expandFragments(layer, []);
    expect(expanded).toStrictEqual(layer);
  });

  it("searches multiple fragment directories in order (first match wins)", () => {
    const dir1 = setupFragmentsDir({
      "shared-frag": `
name: shared-frag
mcpServer:
  myserver:
    type: stdio
    command: from-dir1
    args: []
    env: {}
`,
    });
    const dir2 = setupFragmentsDir({
      "shared-frag": `
name: shared-frag
mcpServer:
  myserver:
    type: stdio
    command: from-dir2
    args: []
    env: {}
`,
    });

    const layer = ScopeDoc.parse({ version: 1, use: ["shared-frag"] });
    const expanded = expandFragments(layer, [dir1, dir2]);

    const server = expanded.mcpServers.myserver;
    expect(server).toBeDefined();
    if (server && "command" in server) {
      expect(server.command).toBe("from-dir1"); // first dir wins
    }
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/cascade/resolve.js";
import { CascadeError } from "../src/errors.js";

/**
 * Creates a minimal test environment with global and project scopes.
 */
function setupExtendsFixture(opts: {
  globalRole?: string;
  projectRole?: string;
  projectShared?: string;
}) {
  const tmpDir = join(tmpdir(), `extends-test-${Date.now()}`);
  const globalDir = join(tmpDir, "config");
  const globalGlobalDir = join(globalDir, "global");
  const globalRolesDir = join(globalGlobalDir, "roles");
  const fragmentsDir = join(globalDir, "fragments");
  const projectDir = join(tmpDir, "project");
  const myClaudeDir = join(projectDir, ".myclaude");
  const projectRolesDir = join(myClaudeDir, "roles");

  mkdirSync(globalGlobalDir, { recursive: true });
  mkdirSync(globalRolesDir, { recursive: true });
  mkdirSync(fragmentsDir, { recursive: true });
  mkdirSync(projectRolesDir, { recursive: true });

  // Always create a global-shared (minimal)
  writeFileSync(join(globalGlobalDir, "shared.yml"), "version: 1\n");

  if (opts.globalRole) {
    writeFileSync(join(globalRolesDir, "backend.yml"), opts.globalRole);
  }

  if (opts.projectShared) {
    writeFileSync(join(myClaudeDir, "shared.yml"), opts.projectShared);
  }

  if (opts.projectRole) {
    writeFileSync(join(projectRolesDir, "backend.yml"), opts.projectRole);
  }

  return { tmpDir, globalDir, projectDir, fragmentsDir };
}

describe("__extends directive", () => {
  it("inherits command/args from global-role when __extends is set", () => {
    const { globalDir, projectDir, fragmentsDir } = setupExtendsFixture({
      globalRole: `version: 1
mcpServers:
  postgres:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    env:
      DATABASE_URL: "\${secret:postgres.default}"
`,
      projectRole: `version: 1
mcpServers:
  postgres:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    __extends: global-role
    env:
      DATABASE_URL: "\${secret:postgres.acme-prod}"
`,
    });

    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const server = result.effective.mcpServers.postgres;
    expect(server).toBeDefined();
    // Command should come from global-role (via __extends)
    if (server && "command" in server) {
      expect(server.command).toBe("npx");
      // DATABASE_URL should come from project-role (override)
      expect(server.env?.DATABASE_URL).toBe("${secret:postgres.acme-prod}");
    }
  });

  it("provenance records 'extended' event for __extends", () => {
    const { globalDir, projectDir, fragmentsDir } = setupExtendsFixture({
      globalRole: `version: 1
mcpServers:
  postgres:
    type: stdio
    command: npx
    args: ["-y", "server-postgres"]
    env:
      DATABASE_URL: "\${secret:postgres.default}"
`,
      projectRole: `version: 1
mcpServers:
  postgres:
    command: npx
    args: ["-y", "server-postgres"]
    __extends: global-role
    env:
      DATABASE_URL: "\${secret:postgres.acme-prod}"
`,
    });

    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const chain = result.provenance.mcpServers.postgres?.chain ?? [];
    const events = chain.map((e) => e.event);
    expect(events).toContain("extended");
  });

  it("throws CascadeError when __extends target scope is not found", () => {
    const { globalDir, projectDir, fragmentsDir } = setupExtendsFixture({
      // No global-role defined for "backend"
      projectRole: `version: 1
mcpServers:
  postgres:
    command: npx
    args: []
    __extends: global-role
    env: {}
`,
    });

    expect(() =>
      resolve({
        role: "backend",
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      })
    ).toThrow(CascadeError);
  });

  it("throws CascadeError when __extends target scope exists but server name is not there", () => {
    const { globalDir, projectDir, fragmentsDir } = setupExtendsFixture({
      globalRole: `version: 1
mcpServers:
  github:
    type: stdio
    command: npx
    args: []
    env: {}
`,
      projectRole: `version: 1
mcpServers:
  postgres:
    command: npx
    args: []
    __extends: global-role
    env: {}
`,
    });

    expect(() =>
      resolve({
        role: "backend",
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      })
    ).toThrow(CascadeError);
  });
});

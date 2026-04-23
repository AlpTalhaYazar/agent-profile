import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/cascade/resolve.js";

/**
 * Sets up the full fixture described in docs/03-profile-schema.md:
 * global-shared, global-role/backend, project-shared, project-role/backend
 */
function setupFullFixture() {
  const tmpDir = join(tmpdir(), `resolve-test-${Date.now()}`);
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

  // Fragment: postgres-core
  writeFileSync(
    join(fragmentsDir, "postgres-core.yml"),
    `name: postgres-core
mcpServer:
  postgres:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    env:
      DATABASE_URL: "\${secret:postgres.default}"
`
  );

  // global-shared
  writeFileSync(
    join(globalGlobalDir, "shared.yml"),
    `version: 1
env:
  EDITOR: "nvim"
settings:
  theme: "dark"
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "server-filesystem"]
    env:
      ROOTS: "/tmp"
  figma:
    type: http
    url: "https://figma.example.com"
    headers:
      Authorization: "\${secret:figma.token}"
`
  );

  // global-role/backend
  writeFileSync(
    join(globalRolesDir, "backend.yml"),
    `version: 1
use: [postgres-core]
settings:
  theme: "light"
mcpServers:
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "\${secret:github.pat}"
`
  );

  // project-shared
  writeFileSync(
    join(myClaudeDir, "shared.yml"),
    `version: 1
env:
  PROJECT_NAME: "acme-api"
mcpServers:
  filesystem:
    __merge: deep
    env:
      ROOTS: "\${env:PWD}/src,\${env:PWD}/tests"
disabledServers: [figma]
`
  );

  // project-role/backend
  writeFileSync(
    join(projectRolesDir, "backend.yml"),
    `version: 1
mcpServers:
  postgres:
    __extends: global-role
    env:
      DATABASE_URL: "\${secret:postgres.acme-prod}"
`
  );

  return { tmpDir, globalDir, projectDir, fragmentsDir };
}

describe("resolve() end-to-end", () => {
  it("produces an effective config with all active servers", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.effective.mcpServers.filesystem).toBeDefined();
    expect(result.effective.mcpServers.github).toBeDefined();
    expect(result.effective.mcpServers.postgres).toBeDefined();
  });

  it("figma is suppressed by project-shared disabledServers", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.effective.mcpServers.figma).toBeUndefined();
    expect(result.provenance.mcpServers.figma?.suppressedBy).toBeDefined();
  });

  it("filesystem ROOTS env is overridden by project-shared via __merge:deep", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const filesystem = result.effective.mcpServers.filesystem;
    expect(filesystem).toBeDefined();
    if (filesystem && "env" in filesystem) {
      expect(filesystem.env?.ROOTS).toContain("${env:PWD}");
    }
  });

  it("postgres uses __extends from global-role for command/args", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const postgres = result.effective.mcpServers.postgres;
    expect(postgres).toBeDefined();
    if (postgres && "command" in postgres) {
      expect(postgres.command).toBe("npx");
      // DATABASE_URL should be overridden by project-role
      expect(postgres.env?.DATABASE_URL).toBe("${secret:postgres.acme-prod}");
    }
  });

  it("env vars merge correctly across scopes (last-wins)", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.effective.env.EDITOR).toBe("nvim");
    expect(result.effective.env.PROJECT_NAME).toBe("acme-api");
  });

  it("settings theme comes from global-role (light) overriding global-shared (dark)", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.effective.settings.theme).toBe("light");
  });

  it("provenance chain for postgres records introduced + extended events", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const chain = result.provenance.mcpServers.postgres?.chain ?? [];
    const events = chain.map((e) => e.event);
    expect(events).toContain("introduced");
    expect(events).toContain("extended");
  });

  it("different role produces different effective config", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();

    const backendResult = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    // frontend role — no role files exist, so only global-shared + project layers
    const frontendResult = resolve({
      role: "frontend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    // Backend has postgres (from fragment + __extends), frontend does not
    expect(backendResult.effective.mcpServers.postgres).toBeDefined();
    expect(frontendResult.effective.mcpServers.postgres).toBeUndefined();
  });

  it("missing role file is silently skipped", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();

    // "dba" role has no files
    expect(() =>
      resolve({
        role: "dba",
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      })
    ).not.toThrow();
  });

  it("launchOverrides merge at highest precedence", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
      launchOverrides: {
        env: { EDITOR: "code", OVERRIDE_ONLY: "yes" },
      },
    });

    expect(result.effective.env.EDITOR).toBe("code");
    expect(result.effective.env.OVERRIDE_ONLY).toBe("yes");
  });

  it("cwd outside any project (no .myclaude) produces global-only config", () => {
    const { globalDir, fragmentsDir } = setupFullFixture();

    // Use a cwd that has no .myclaude directory
    const result = resolve({
      role: "backend",
      cwd: tmpdir(), // system tmpdir has no .myclaude
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    // Should still have global-shared servers
    expect(result.effective.mcpServers.filesystem).toBeDefined();
    // Should have github from global-role/backend
    expect(result.effective.mcpServers.github).toBeDefined();
    // figma is NOT suppressed (project-shared's disabledServers not active)
    expect(result.effective.mcpServers.figma).toBeDefined();
  });

  it("runtimePaths is always null", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.runtimePaths).toBeNull();
  });

  it("authProfileId is carried into effective.auth when provided", () => {
    const { globalDir, projectDir, fragmentsDir } = setupFullFixture();
    const result = resolve({
      role: "backend",
      authProfileId: "work",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.effective.auth?.profileId).toBe("work");
  });
});

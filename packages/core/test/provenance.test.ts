import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/cascade/resolve.js";

function setupProvenanceFixture() {
  const tmpDir = join(tmpdir(), `provenance-test-${Date.now()}`);
  const globalDir = join(tmpDir, "config");
  const globalGlobalDir = join(globalDir, "global");
  const globalRolesDir = join(globalGlobalDir, "roles");
  const fragmentsDir = join(globalDir, "fragments");
  const projectDir = join(tmpDir, "project");
  const myClaudeDir = join(projectDir, ".myclaude");

  mkdirSync(globalGlobalDir, { recursive: true });
  mkdirSync(globalRolesDir, { recursive: true });
  mkdirSync(fragmentsDir, { recursive: true });
  mkdirSync(myClaudeDir, { recursive: true });

  writeFileSync(
    join(globalGlobalDir, "shared.yml"),
    `version: 1
mcpServers:
  github:
    type: stdio
    command: npx
    args: ["-y", "server-github"]
    env:
      GITHUB_TOKEN: "\${secret:github.default}"
  figma:
    type: http
    url: "https://figma.example.com"
    headers:
      Authorization: "\${secret:figma.token}"
env:
  GLOBAL_VAR: "global-value"
  SHARED_VAR: "from-global"
settings:
  theme: "dark"
`
  );

  writeFileSync(
    join(globalRolesDir, "backend.yml"),
    `version: 1
mcpServers:
  postgres:
    type: stdio
    command: npx
    args: ["-y", "server-postgres"]
    env:
      DATABASE_URL: "\${secret:postgres.default}"
env:
  SHARED_VAR: "from-global-role"
  ROLE_VAR: "role-value"
`
  );

  writeFileSync(
    join(myClaudeDir, "shared.yml"),
    `version: 1
disabledServers: [figma]
env:
  PROJECT_VAR: "project-value"
  SHARED_VAR: "from-project"
`
  );

  return { tmpDir, globalDir, projectDir, fragmentsDir };
}

describe("Provenance", () => {
  it("every active field has a source scope in provenance", () => {
    const { globalDir, projectDir, fragmentsDir } = setupProvenanceFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    // Every active mcpServer should have provenance
    for (const serverName of Object.keys(result.effective.mcpServers)) {
      expect(result.provenance.mcpServers[serverName]).toBeDefined();
      expect(result.provenance.mcpServers[serverName]?.source).toBeDefined();
    }

    // Every env var should have provenance
    for (const envKey of Object.keys(result.effective.env)) {
      expect(result.provenance.env[envKey]).toBeDefined();
    }
  });

  it("provenance.chain records introduction event for first occurrence", () => {
    const { globalDir, projectDir, fragmentsDir } = setupProvenanceFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const githubChain = result.provenance.mcpServers.github?.chain ?? [];
    expect(githubChain[0]?.event).toBe("introduced");
  });

  it("suppressed entries have suppressedBy set and are absent from effective.mcpServers", () => {
    const { globalDir, projectDir, fragmentsDir } = setupProvenanceFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    // figma is suppressed by project-shared
    expect(result.effective.mcpServers.figma).toBeUndefined();
    const figmaProv = result.provenance.mcpServers.figma;
    expect(figmaProv?.suppressedBy).toBeDefined();
  });

  it("env provenance tracks which scope last set each key", () => {
    const { globalDir, projectDir, fragmentsDir } = setupProvenanceFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    // SHARED_VAR is set by global-shared, then global-role, then project-shared
    const sharedVarProv = result.provenance.env.SHARED_VAR;
    expect(sharedVarProv).toBeDefined();
    // Chain should have multiple entries (introduced + overridden)
    expect(sharedVarProv?.chain.length ?? 0).toBeGreaterThan(1);
  });

  it("settings provenance tracks which scope supplied the key", () => {
    const { globalDir, projectDir, fragmentsDir } = setupProvenanceFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    const themeProv = result.provenance.settings.theme;
    expect(themeProv).toBeDefined();
    expect(themeProv?.source).toBeDefined();
  });

  it("runtimePaths is always null at the core layer", () => {
    const { globalDir, projectDir, fragmentsDir } = setupProvenanceFixture();
    const result = resolve({
      role: "backend",
      cwd: projectDir,
      globalConfigDir: globalDir,
      fragmentDirs: [fragmentsDir],
    });

    expect(result.runtimePaths).toBeNull();
  });
});

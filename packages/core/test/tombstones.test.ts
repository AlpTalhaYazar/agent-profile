import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/cascade/resolve.js";

/**
 * Creates a temporary directory structure for tombstone tests.
 * Returns the global config dir and a project directory.
 */
function setupTombstoneFixture(overrides?: {
  globalShared?: string;
  projectShared?: string;
  projectRole?: string;
}) {
  const tmpDir = join(tmpdir(), `tombstone-test-${Date.now()}`);
  const globalDir = join(tmpDir, "config");
  const globalGlobalDir = join(globalDir, "global");
  const fragmentsDir = join(globalDir, "fragments");
  const projectDir = join(tmpDir, "project");
  const myClaudeDir = join(projectDir, ".myclaude");
  const rolesDir = join(myClaudeDir, "roles");

  mkdirSync(globalGlobalDir, { recursive: true });
  mkdirSync(fragmentsDir, { recursive: true });
  mkdirSync(rolesDir, { recursive: true });

  const defaultGlobalShared = `version: 1
mcpServers:
  figma:
    type: http
    url: "https://figma.example.com"
    headers: {}
  browser-use:
    type: stdio
    command: npx
    args: ["-y", "server-browser"]
    env: {}
env:
  GLOBAL: "global-value"
`;

  const defaultProjectShared = `version: 1
mcpServers:
  figma: null
disabledServers: [browser-use]
env:
  PROJECT: "project-value"
`;

  writeFileSync(
    join(globalGlobalDir, "shared.yml"),
    overrides?.globalShared ?? defaultGlobalShared
  );
  writeFileSync(join(myClaudeDir, "shared.yml"), overrides?.projectShared ?? defaultProjectShared);

  if (overrides?.projectRole) {
    writeFileSync(join(rolesDir, "backend.yml"), overrides.projectRole);
  }

  return { tmpDir, globalDir, projectDir, fragmentsDir };
}

describe("Tombstones", () => {
  describe("null value tombstone", () => {
    it("null value in project-shared suppresses global-shared server", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture();
      const result = resolve({
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      expect(result.effective.mcpServers.figma).toBeUndefined();
    });

    it("provenance records suppressedBy for null tombstone", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture();
      const result = resolve({
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      const figmaProv = result.provenance.mcpServers.figma;
      expect(figmaProv?.suppressedBy).toBeDefined();
    });
  });

  describe("enabled:false tombstone", () => {
    it("enabled:false in project-shared suppresses the server", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture({
        projectShared: `version: 1
mcpServers:
  figma:
    type: http
    url: "https://figma.example.com"
    enabled: false
`,
      });
      const result = resolve({
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      expect(result.effective.mcpServers.figma).toBeUndefined();
    });

    it("provenance records suppressedBy for enabled:false tombstone", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture({
        projectShared: `version: 1
mcpServers:
  figma:
    type: http
    url: "https://figma.example.com"
    enabled: false
`,
      });
      const result = resolve({
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      const figmaProv = result.provenance.mcpServers.figma;
      expect(figmaProv?.suppressedBy).toBeDefined();
    });
  });

  describe("disabledServers tombstone", () => {
    it("disabledServers list suppresses server same as null tombstone", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture();
      const result = resolve({
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      // browser-use is in disabledServers
      expect(result.effective.mcpServers["browser-use"]).toBeUndefined();
    });

    it("provenance records suppressedBy for disabledServers tombstone", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture();
      const result = resolve({
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      const prov = result.provenance.mcpServers["browser-use"];
      expect(prov?.suppressedBy).toBeDefined();
    });
  });

  describe("tombstone re-introduction", () => {
    it("server tombstoned at mid-layer can be re-introduced at higher layer", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture({
        projectRole: `version: 1
mcpServers:
  figma:
    type: http
    url: "https://figma.example.com/v2"
    headers: {}
`,
      });
      const result = resolve({
        role: "backend",
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      // figma was suppressed in project-shared but re-introduced in project-role
      expect(result.effective.mcpServers.figma).toBeDefined();
      if (result.effective.mcpServers.figma) {
        const server = result.effective.mcpServers.figma;
        expect("url" in server && server.url).toBe("https://figma.example.com/v2");
      }
    });

    it("provenance shows full chain for re-introduced server", () => {
      const { globalDir, projectDir, fragmentsDir } = setupTombstoneFixture({
        projectRole: `version: 1
mcpServers:
  figma:
    type: http
    url: "https://figma.example.com/v2"
    headers: {}
`,
      });
      const result = resolve({
        role: "backend",
        cwd: projectDir,
        globalConfigDir: globalDir,
        fragmentDirs: [fragmentsDir],
      });
      const figmaProv = result.provenance.mcpServers.figma;
      expect(figmaProv).toBeDefined();
      expect(figmaProv?.chain.length).toBeGreaterThan(1);
      // suppressedBy should be cleared when re-introduced
      expect(figmaProv?.suppressedBy).toBeUndefined();
    });
  });
});

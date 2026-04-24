/**
 * Tests for `myclaude profile list`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverScopes } from "../../src/utils/scope-discovery.js";

// FIXTURES_HOME is the equivalent of ~/.myclaude (the actual myclaude home dir)
const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("../fixtures/project", import.meta.url).pathname);

describe("discoverScopes (profile list logic)", () => {
  it("discovers global-shared scope", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    const shared = entries.find((e) => e.scope === "global-shared");
    expect(shared).toBeDefined();
    expect(shared?.role).toBe("—");
    expect(shared?.filePath).toContain("shared.yml");
  });

  it("discovers global role files alphabetically", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    const roles = entries.filter((e) => e.scope === "global-role");
    expect(roles.length).toBeGreaterThanOrEqual(2);
    // Roles should be alphabetically ordered
    const roleNames = roles.map((r) => r.role);
    expect(roleNames).toEqual([...roleNames].sort());
  });

  it("discovers backend global role", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    const backend = entries.find((e) => e.scope === "global-role" && e.role === "backend");
    expect(backend).toBeDefined();
    expect(backend?.filePath).toContain("backend.yml");
  });

  it("discovers frontend global role", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    const frontend = entries.find((e) => e.scope === "global-role" && e.role === "frontend");
    expect(frontend).toBeDefined();
  });

  it("discovers project scopes when cwd is inside project", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_PROJECT });
    const projectShared = entries.find((e) => e.scope === "project-shared");
    expect(projectShared).toBeDefined();
    expect(projectShared?.filePath).toContain("shared.yml");
  });

  it("discovers project role files", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_PROJECT });
    const projectBackend = entries.find((e) => e.scope === "project-role" && e.role === "backend");
    expect(projectBackend).toBeDefined();
  });

  it("order is deterministic: global scopes before project scopes", () => {
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_PROJECT });
    const globalIdx = entries.findIndex((e) => e.scope === "global-shared");
    const projectIdx = entries.findIndex((e) => e.scope === "project-shared");
    expect(globalIdx).toBeLessThan(projectIdx);
  });

  it("--role filter returns only scopes contributing to that role", () => {
    const entries = discoverScopes({
      home: FIXTURES_HOME,
      cwd: FIXTURES_PROJECT,
      filterRole: "backend",
    });
    const roles = entries.filter((e) => e.scope === "global-role" || e.scope === "project-role");
    for (const entry of roles) {
      expect(entry.role).toBe("backend");
    }
  });

  it("--role filter excludes other global roles", () => {
    const entries = discoverScopes({
      home: FIXTURES_HOME,
      cwd: FIXTURES_PROJECT,
      filterRole: "backend",
    });
    const frontend = entries.find((e) => e.role === "frontend");
    expect(frontend).toBeUndefined();
  });

  it("returns empty array for a home with no config", () => {
    const entries = discoverScopes({ home: "/nonexistent/path", cwd: "/nonexistent/path" });
    expect(entries).toEqual([]);
  });

  it("discovers project-shared-local scope when local.yml exists", () => {
    const tempProject = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempProject, ".myclaude"), { recursive: true });
    writeFileSync(
      join(tempProject, ".myclaude", "local.yml"),
      "version: 1\nmcpServers: {}\nenv: {}\nsettings: {}\n"
    );
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: tempProject });
    const local = entries.find((e) => e.scope === "project-shared-local");
    expect(local).toBeDefined();
    expect(local?.role).toBe("—");
    rmSync(tempProject, { recursive: true, force: true });
  });

  it("discovers project-shared-local with filterRole still includes it", () => {
    const tempProject = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempProject, ".myclaude"), { recursive: true });
    writeFileSync(
      join(tempProject, ".myclaude", "local.yml"),
      "version: 1\nmcpServers: {}\nenv: {}\nsettings: {}\n"
    );
    const entries = discoverScopes({
      home: FIXTURES_HOME,
      cwd: tempProject,
      filterRole: "backend",
    });
    const local = entries.find((e) => e.scope === "project-shared-local");
    expect(local).toBeDefined();
    rmSync(tempProject, { recursive: true, force: true });
  });
});

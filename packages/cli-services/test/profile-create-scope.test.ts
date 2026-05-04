import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError, profileCreateScopeService } from "../src/index.js";

describe("profileCreateScopeService", () => {
  let root: string;
  let home: string;
  let cwd: string;

  beforeEach(() => {
    root = join(
      tmpdir(),
      `profile-create-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    home = join(root, ".myclaude");
    cwd = join(root, "repo");
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates every supported scope path with canonical empty content", () => {
    const cases = [
      {
        location: "global" as const,
        layerType: "shared" as const,
        expectedPath: join(home, "config", "global", "shared.yml"),
        expectedScope: "global-shared",
      },
      {
        location: "global" as const,
        layerType: "role" as const,
        role: "backend",
        expectedPath: join(home, "config", "global", "roles", "backend.yml"),
        expectedScope: "global-role",
      },
      {
        location: "project" as const,
        layerType: "shared" as const,
        expectedPath: join(cwd, ".myclaude", "shared.yml"),
        expectedScope: "project-shared",
      },
      {
        location: "project" as const,
        layerType: "role" as const,
        role: "frontend",
        expectedPath: join(cwd, ".myclaude", "roles", "frontend.yml"),
        expectedScope: "project-role",
      },
    ];

    for (const item of cases) {
      const result = profileCreateScopeService({
        home,
        cwd,
        location: item.location,
        layerType: item.layerType,
        ...(item.role ? { role: item.role } : {}),
      });
      expect(result).toMatchObject({
        created: true,
        path: item.expectedPath,
        scope: item.expectedScope,
        role: item.role ?? null,
      });
      const content = readFileSync(item.expectedPath, "utf8");
      expect(content).toContain("version: 1");
      expect(content).toContain("mcpServers: {}");
    }
  });

  it("rejects conflicts unless force is set", () => {
    profileCreateScopeService({
      home,
      cwd,
      location: "project",
      layerType: "role",
      role: "backend",
    });

    expect(() =>
      profileCreateScopeService({
        home,
        cwd,
        location: "project",
        layerType: "role",
        role: "backend",
      })
    ).toThrow(ServiceError);

    expect(() =>
      profileCreateScopeService({
        home,
        cwd,
        location: "project",
        layerType: "role",
        role: "backend",
        force: true,
      })
    ).not.toThrow();
  });

  it("requires valid role names for role-specific layers", () => {
    expect(() =>
      profileCreateScopeService({
        home,
        cwd,
        location: "project",
        layerType: "role",
      })
    ).toThrow(/Role name is required/);

    expect(() =>
      profileCreateScopeService({
        home,
        cwd,
        location: "project",
        layerType: "role",
        role: "Backend Team",
      })
    ).toThrow(/Role name must match/);
  });

  it("keeps project scope creation pinned to the explicit cwd", () => {
    const repoDir = join(root, "monorepo");
    const packageDir = join(repoDir, "apps", "web");
    mkdirSync(packageDir, { recursive: true });

    const result = profileCreateScopeService({
      home,
      cwd: packageDir,
      location: "project",
      layerType: "shared",
    });

    expect(result.path).toBe(join(packageDir, ".myclaude", "shared.yml"));
    expect(readFileSync(result.path, "utf8")).toContain("version: 1");
  });
});

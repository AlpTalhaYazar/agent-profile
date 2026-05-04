import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { profileListService } from "../src/profile/list.js";

const FIXTURES_HOME = resolve(new URL("./fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("./fixtures/project", import.meta.url).pathname);

describe("profileListService", () => {
  it("lists scopes in deterministic cascade order", () => {
    const result = profileListService({
      home: FIXTURES_HOME,
      cwd: FIXTURES_PROJECT,
    });

    expect(result.scopes.map((entry) => [entry.scope, entry.role])).toEqual([
      ["global-shared", null],
      ["global-role", "backend"],
      ["global-role", "frontend"],
      ["project-shared", null],
      ["project-role", "backend"],
    ]);
    expect(result.scopes[0]?.content?.version).toBe(1);
    expect(result.scopes[0]?.content?.env.EDITOR).toBe("nvim");
  });

  it("keeps shared scopes while filtering role-scoped entries", () => {
    const result = profileListService({
      home: FIXTURES_HOME,
      cwd: FIXTURES_PROJECT,
      roleFilter: "backend",
    });

    expect(result.scopes.map((entry) => [entry.scope, entry.role])).toEqual([
      ["global-shared", null],
      ["global-role", "backend"],
      ["project-shared", null],
      ["project-role", "backend"],
    ]);
  });

  it("lists monorepo root and deepest package scopes in cascade order", () => {
    const root = join(tmpdir(), `profile-list-monorepo-${Date.now()}`);
    const home = join(root, "home", ".myclaude");
    const repoDir = join(root, "repo");
    const packageDir = join(repoDir, "apps", "web");
    try {
      mkdirSync(join(home, "config", "global"), { recursive: true });
      mkdirSync(join(repoDir, ".myclaude"), { recursive: true });
      mkdirSync(join(packageDir, ".myclaude", "roles"), { recursive: true });
      writeFileSync(join(repoDir, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
      writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "web" }));
      writeFileSync(join(repoDir, ".myclaude", "shared.yml"), "version: 1\n");
      writeFileSync(join(packageDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");

      const result = profileListService({
        home,
        cwd: join(packageDir, "src"),
        roleFilter: "backend",
      });

      expect(result.scopes.map((entry) => [entry.scope, entry.role, entry.filePath])).toEqual([
        ["project-shared", null, join(repoDir, ".myclaude", "shared.yml")],
        ["project-role", "backend", join(packageDir, ".myclaude", "roles", "backend.yml")],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

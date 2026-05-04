import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMonorepoRoot, findProjectChain, findWorkspaceCandidates } from "../src/index.js";

describe("monorepo workspace detection", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "myclaude-monorepo-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the root-to-deepest candidate chain for ancestor packages", () => {
    const appDir = join(root, "apps", "web");
    const nestedDir = join(appDir, "features", "admin");
    const cwd = join(nestedDir, "src");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    writeJson(join(appDir, "package.json"), { name: "web" });
    writeJson(join(nestedDir, "package.json"), { name: "admin" });
    mkdirSync(join(root, ".myclaude"), { recursive: true });
    mkdirSync(join(nestedDir, ".myclaude"), { recursive: true });

    expect(findWorkspaceCandidates(cwd)).toEqual([
      expect.objectContaining({ kind: "root", path: root, hasMyClaude: true }),
      expect.objectContaining({ kind: "package", path: appDir, hasMyClaude: false }),
      expect.objectContaining({ kind: "package", path: nestedDir, hasMyClaude: true }),
    ]);
  });

  it("does not add marker-only monorepo roots to the project cascade", () => {
    const packageDir = join(root, "apps", "web");
    mkdirSync(join(packageDir, ".myclaude"), { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    writeJson(join(packageDir, "package.json"), { name: "web" });

    expect(findProjectChain(join(packageDir, "src"))).toEqual([packageDir]);
  });

  it("does not surface package.json ancestors above the detected monorepo root", () => {
    const repoDir = join(root, "repo");
    const packageDir = join(repoDir, "apps", "web");
    mkdirSync(packageDir, { recursive: true });
    writeJson(join(root, "package.json"), { name: "outer-parent" });
    writeFileSync(join(repoDir, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    writeJson(join(packageDir, "package.json"), { name: "web" });

    expect(
      findWorkspaceCandidates(join(packageDir, "src")).map((candidate) => candidate.path)
    ).toEqual([repoDir, packageDir]);
  });

  it("keeps legacy .myclaude upward chaining without monorepo markers", () => {
    const parentDir = join(root, "repo");
    const childDir = join(parentDir, "packages", "cli");
    mkdirSync(join(parentDir, ".myclaude"), { recursive: true });
    mkdirSync(join(childDir, ".myclaude"), { recursive: true });

    expect(findProjectChain(childDir)).toEqual([parentDir, childDir]);
  });

  it("uses the documented marker priority when several markers share a directory", () => {
    const cwd = join(root, "apps", "web");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    writeFileSync(join(root, "nx.json"), "{}");
    writeFileSync(join(root, "turbo.json"), "{}");
    writeFileSync(join(root, "lerna.json"), "{}");
    writeFileSync(join(root, "rush.json"), "{}");
    writeJson(join(root, "package.json"), { workspaces: ["apps/*"] });

    expect(findMonorepoRoot(cwd)).toEqual(
      expect.objectContaining({
        path: root,
        marker: "pnpm-workspace.yaml",
        markerPath: join(root, "pnpm-workspace.yaml"),
      })
    );
  });

  it("falls back to a git root when no workspace marker exists", () => {
    const cwd = join(root, "packages", "api");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });

    expect(findMonorepoRoot(cwd)).toEqual(
      expect.objectContaining({
        path: root,
        marker: "git",
        markerPath: join(root, ".git"),
      })
    );
  });
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), "utf8");
}

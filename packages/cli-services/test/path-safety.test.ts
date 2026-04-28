import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors.js";
import { assertAllowlistedScopePath } from "../src/profile/shared.js";

const skipOnWindows = process.platform === "win32";

describe("assertAllowlistedScopePath", () => {
  let root: string;
  let home: string;
  let projectDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "path-safety-"));
    home = join(root, "home");
    projectDir = join(root, "project");
    mkdirSync(join(home, "config", "global", "roles"), { recursive: true });
    mkdirSync(join(projectDir, ".myclaude", "roles"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("allowed paths", () => {
    it("permits global shared.yml", () => {
      const path = join(home, "config", "global", "shared.yml");
      expect(assertAllowlistedScopePath(home, path)).toBe(path);
    });

    it("permits global role files", () => {
      const path = join(home, "config", "global", "roles", "backend.yml");
      expect(assertAllowlistedScopePath(home, path)).toBe(path);
    });

    it("permits project shared.yml", () => {
      const path = join(projectDir, ".myclaude", "shared.yml");
      expect(assertAllowlistedScopePath(home, path)).toBe(path);
    });

    it("permits project local.yml", () => {
      const path = join(projectDir, ".myclaude", "local.yml");
      expect(assertAllowlistedScopePath(home, path)).toBe(path);
    });

    it("permits project role files", () => {
      const path = join(projectDir, ".myclaude", "roles", "frontend.yml");
      expect(assertAllowlistedScopePath(home, path)).toBe(path);
    });

    it("uses the deepest .myclaude segment when nested", () => {
      const nested = join(root, "outer", ".myclaude", "inner", ".myclaude");
      mkdirSync(nested, { recursive: true });
      const path = join(nested, "shared.yml");
      expect(assertAllowlistedScopePath(home, path)).toBe(path);
    });
  });

  describe("disallowed paths", () => {
    it("rejects persona/ writes", () => {
      const path = join(projectDir, ".myclaude", "persona", "backend.md");
      expect(() => assertAllowlistedScopePath(home, path)).toThrow(ServiceError);
    });

    it("rejects nested directories under roles/", () => {
      const path = join(projectDir, ".myclaude", "roles", "sub", "nested.yml");
      expect(() => assertAllowlistedScopePath(home, path)).toThrow(ServiceError);
    });

    it("rejects ../ traversal that escapes the .myclaude scope", () => {
      const path = join(projectDir, ".myclaude", "..", "..", "..", "etc", "passwd");
      expect(() => assertAllowlistedScopePath(home, path)).toThrow(ServiceError);
    });

    it("rejects paths with no .myclaude segment", () => {
      const path = join(root, "rogue", "shared.yml");
      mkdirSync(join(root, "rogue"), { recursive: true });
      expect(() => assertAllowlistedScopePath(home, path)).toThrow(ServiceError);
    });

    it("rejects paths containing null bytes", () => {
      expect(() => assertAllowlistedScopePath(home, "/etc/\0/passwd")).toThrow(ServiceError);
    });
  });

  describe.skipIf(skipOnWindows)("symlink traversal", () => {
    it("rejects an allowlisted scope path that symlinks outside the allowlist", () => {
      const outside = join(root, "outside");
      mkdirSync(outside, { recursive: true });
      const evilTarget = join(outside, "evil.yml");
      writeFileSync(evilTarget, "evil: true");

      const symlinkPath = join(home, "config", "global", "shared.yml");
      symlinkSync(evilTarget, symlinkPath);

      expect(() => assertAllowlistedScopePath(home, symlinkPath)).toThrow(ServiceError);
    });

    it("rejects when the parent directory is a symlink to an outside location", () => {
      const outside = join(root, "outside-dir");
      mkdirSync(outside, { recursive: true });

      const fakeProject = join(root, "fake-project");
      mkdirSync(fakeProject, { recursive: true });
      symlinkSync(outside, join(fakeProject, ".myclaude"));

      const path = join(fakeProject, ".myclaude", "shared.yml");
      expect(() => assertAllowlistedScopePath(home, path)).toThrow(ServiceError);
    });

    it("permits a symlink that resolves back inside the allowlist", () => {
      const realDir = join(root, "real-myclaude");
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, "shared.yml"), "version: 1\n");

      const symlinkProject = join(root, "linked-project");
      mkdirSync(symlinkProject, { recursive: true });
      symlinkSync(realDir, join(symlinkProject, ".myclaude"));

      const path = join(symlinkProject, ".myclaude", "shared.yml");
      // realpath resolves to <root>/real-myclaude/shared.yml — no .myclaude
      // segment, so allowlist must reject. This is the safe default: a
      // confused-deputy symlink trick cannot smuggle writes through.
      expect(() => assertAllowlistedScopePath(home, path)).toThrow(ServiceError);
    });
  });
});

/**
 * Tests for `use` and `unuse` activation commands.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUnuse, unuseCommand } from "../../src/commands/unuse.js";
import { runUse, useCommand } from "../../src/commands/use.js";
import { CliError } from "../../src/errors.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "myclaude-use-unuse-"));
}

function ctx(args: Record<string, unknown>, cmd: unknown): unknown {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

const asUseCtx = (value: unknown) => value as Parameters<NonNullable<typeof useCommand.run>>[0];
const asUnuseCtx = (value: unknown) => value as Parameters<NonNullable<typeof unuseCommand.run>>[0];

describe("use and unuse commands", () => {
  let tempDir: string;
  let stdout: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("use writes role and auth to the nearest existing .myclaude marker", () => {
    const projectDir = join(tempDir, "repo");
    const childDir = join(projectDir, "packages", "cli");
    const markerDir = join(projectDir, ".myclaude");
    mkdirSync(childDir, { recursive: true });
    mkdirSync(markerDir, { recursive: true });

    runUse({ role: "backend", auth: "work", cwd: childDir });

    const rolePath = join(markerDir, "role");
    const authPath = join(markerDir, "auth");
    expect(readFileSync(rolePath, "utf8")).toBe("backend\n");
    expect(readFileSync(authPath, "utf8")).toBe("work\n");
    expect(existsSync(join(childDir, ".myclaude"))).toBe(false);
    expect(statSync(rolePath).mode & 0o777).toBe(0o600);
    expect(statSync(authPath).mode & 0o777).toBe(0o600);
    expect(stdout).toContain(`Wrote ${rolePath} (backend)`);
    expect(stdout).toContain(`Wrote ${authPath} (work)`);
  });

  it("use falls back to <cwd>/.myclaude when no marker exists", () => {
    const cwd = join(tempDir, "repo");
    mkdirSync(cwd, { recursive: true });

    useCommand.run?.(asUseCtx(ctx({ role: "frontend", cwd }, useCommand)));

    const markerDir = join(cwd, ".myclaude");
    expect(readFileSync(join(markerDir, "role"), "utf8")).toBe("frontend\n");
    expect(existsSync(join(markerDir, "auth"))).toBe(false);
  });

  it("use does not write activation state to marker-only monorepo roots", () => {
    const repoDir = join(tempDir, "repo");
    const packageDir = join(repoDir, "apps", "web");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(repoDir, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');

    runUse({ role: "backend", cwd: packageDir });

    expect(existsSync(join(repoDir, ".myclaude"))).toBe(false);
    expect(readFileSync(join(packageDir, ".myclaude", "role"), "utf8")).toBe("backend\n");
  });

  it("use rejects blank role and blank auth values", () => {
    expect(() => runUse({ role: "  ", cwd: tempDir })).toThrow(CliError);
    expect(() => runUse({ role: "backend", auth: "  ", cwd: tempDir })).toThrow(CliError);
  });

  it("unuse removes activation files from the first effective find-up marker", () => {
    const projectDir = join(tempDir, "repo");
    const childDir = join(projectDir, "packages", "cli");
    const projectMarker = join(projectDir, ".myclaude");
    const childMarker = join(childDir, ".myclaude");
    mkdirSync(projectMarker, { recursive: true });
    mkdirSync(childMarker, { recursive: true });
    writeFileSync(join(projectMarker, "role"), "backend\n");
    writeFileSync(join(projectMarker, "auth"), "work\n");

    runUnuse({ cwd: childDir });

    expect(existsSync(join(projectMarker, "role"))).toBe(false);
    expect(existsSync(join(projectMarker, "auth"))).toBe(false);
    expect(existsSync(childMarker)).toBe(true);
    expect(stdout).toContain(`Removed ${join(projectMarker, "role")}`);
    expect(stdout).toContain(`Removed ${join(projectMarker, "auth")}`);
  });

  it("unuse falls back to the nearest existing marker and tolerates absent files", () => {
    const projectDir = join(tempDir, "repo");
    const childDir = join(projectDir, "packages", "cli");
    const projectMarker = join(projectDir, ".myclaude");
    const childMarker = join(childDir, ".myclaude");
    mkdirSync(projectMarker, { recursive: true });
    mkdirSync(childMarker, { recursive: true });
    writeFileSync(join(projectMarker, "role"), "");

    unuseCommand.run?.(asUnuseCtx(ctx({ cwd: childDir }, unuseCommand)));

    expect(existsSync(join(projectMarker, "role"))).toBe(true);
    expect(existsSync(join(childMarker, "role"))).toBe(false);
    expect(existsSync(join(childMarker, "auth"))).toBe(false);
    expect(stdout).toContain("No activation files found.");
  });

  it("unuse does not create a marker when nothing exists", () => {
    const cwd = join(tempDir, "repo");
    mkdirSync(cwd, { recursive: true });

    expect(() => runUnuse({ cwd })).not.toThrow();

    expect(existsSync(join(cwd, ".myclaude"))).toBe(false);
    expect(stdout).toContain("No activation files found.");
  });
});

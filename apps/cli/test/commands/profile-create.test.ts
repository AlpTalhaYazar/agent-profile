/**
 * Tests for `myclaude profile create`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCreate, scaffoldYaml } from "../../src/commands/profile/create.js";
import { CliError } from "../../src/errors.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("scaffoldYaml", () => {
  it("produces valid YAML with schema header comment", () => {
    const yaml = scaffoldYaml("backend");
    expect(yaml).toContain("version: 1");
    expect(yaml).toContain("backend");
  });

  it("includes $schema field", () => {
    const yaml = scaffoldYaml("backend");
    expect(yaml).toContain("$schema");
  });

  it("contains empty mcpServers", () => {
    const yaml = scaffoldYaml("backend");
    expect(yaml).toContain("mcpServers");
  });
});

describe("runCreate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("--global flag", () => {
    it("creates file at global roles path", async () => {
      await runCreate({ role: "backend", global: true, home: tempDir, cwd: tempDir });
      const expected = join(tempDir, "config", "global", "roles", "backend.yml");
      expect(existsSync(expected)).toBe(true);
    });

    it("writes scaffold content to global file", async () => {
      await runCreate({ role: "backend", global: true, home: tempDir, cwd: tempDir });
      const expected = join(tempDir, "config", "global", "roles", "backend.yml");
      const content = readFileSync(expected, "utf8");
      expect(content).toContain("version: 1");
    });

    it("creates intermediate directories", async () => {
      await runCreate({ role: "new-role", global: true, home: tempDir, cwd: tempDir });
      const expected = join(tempDir, "config", "global", "roles", "new-role.yml");
      expect(existsSync(expected)).toBe(true);
    });
  });

  describe("--project flag", () => {
    it("creates file at project roles path", async () => {
      await runCreate({ role: "backend", project: true, home: tempDir, cwd: tempDir });
      const expected = join(tempDir, ".myclaude", "roles", "backend.yml");
      expect(existsSync(expected)).toBe(true);
    });

    it("writes scaffold content to project file", async () => {
      await runCreate({ role: "backend", project: true, home: tempDir, cwd: tempDir });
      const expected = join(tempDir, ".myclaude", "roles", "backend.yml");
      const content = readFileSync(expected, "utf8");
      expect(content).toContain("version: 1");
    });
  });

  describe("existing file", () => {
    it("throws CliError when file already exists (no --force)", async () => {
      // Create the file first
      await runCreate({ role: "backend", global: true, home: tempDir, cwd: tempDir });
      await expect(
        runCreate({ role: "backend", global: true, home: tempDir, cwd: tempDir })
      ).rejects.toBeInstanceOf(CliError);
    });

    it("overwrites with --force", async () => {
      await runCreate({ role: "backend", global: true, home: tempDir, cwd: tempDir });
      await expect(
        runCreate({ role: "backend", global: true, force: true, home: tempDir, cwd: tempDir })
      ).resolves.toBeUndefined();
    });
  });

  describe("no flag in non-interactive mode", () => {
    it("throws CliError when neither --global nor --project and no TTY", async () => {
      // CI=1 forces non-interactive
      process.env.CI = "1";
      try {
        await expect(
          runCreate({ role: "backend", home: tempDir, cwd: tempDir })
        ).rejects.toBeInstanceOf(CliError);
      } finally {
        process.env.CI = undefined;
      }
    });

    it("throws CliError with 'specify --global or --project' message", async () => {
      process.env.CI = "1";
      try {
        let caught: unknown;
        try {
          await runCreate({ role: "backend", home: tempDir, cwd: tempDir });
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(CliError);
        expect((caught as CliError).message).toContain("--global or --project");
      } finally {
        process.env.CI = undefined;
      }
    });
  });

  describe("interactive mode with injected ask function", () => {
    it("creates global file when ask returns 'global'", async () => {
      await runCreate({
        role: "backend",
        home: tempDir,
        cwd: tempDir,
        ask: () => Promise.resolve("global"),
      });
      const expected = join(tempDir, "config", "global", "roles", "backend.yml");
      expect(existsSync(expected)).toBe(true);
    });

    it("creates project file when ask returns 'project'", async () => {
      await runCreate({
        role: "backend",
        home: tempDir,
        cwd: tempDir,
        ask: () => Promise.resolve("project"),
      });
      const expected = join(tempDir, ".myclaude", "roles", "backend.yml");
      expect(existsSync(expected)).toBe(true);
    });

    it("throws CliError with EXIT_USER_CANCELLED when ask returns 'cancel'", async () => {
      let caught: unknown;
      try {
        await runCreate({
          role: "backend",
          home: tempDir,
          cwd: tempDir,
          ask: () => Promise.resolve("cancel"),
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CliError);
      const err = caught as CliError;
      expect(err.exitCode).toBe(6); // EXIT_USER_CANCELLED
    });
  });

  describe("JSON output", () => {
    it("emits JSON with created path when --json is set", async () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        await runCreate({ role: "backend", global: true, json: true, home: tempDir, cwd: tempDir });
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { created: string };
      expect(parsed).toHaveProperty("created");
      expect(parsed.created).toContain("backend.yml");
    });
  });
});

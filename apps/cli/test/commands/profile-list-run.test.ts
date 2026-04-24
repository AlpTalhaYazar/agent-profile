/**
 * Tests exercising `profileListCommand.run` and `profileValidateCommand.run`
 * to cover the citty command wrappers.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileListCommand } from "../../src/commands/profile/list.js";
import { profileValidateCommand } from "../../src/commands/profile/validate.js";
import { CliError } from "../../src/errors.js";

const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

function makeTempDir(): string {
  const dir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function captureOutput(
  fn: () => void | Promise<void>
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === "string") stdoutChunks.push(chunk);
    return true;
  };
  process.stderr.write = (chunk: unknown) => {
    if (typeof chunk === "string") stderrChunks.push(chunk);
    return true;
  };
  const result = fn();
  const restore = () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
  if (result instanceof Promise) {
    return result.then(
      () => {
        restore();
        return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      },
      (err) => {
        restore();
        throw err;
      }
    );
  }
  restore();
  return Promise.resolve({ stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") });
}

// Helper to build a valid citty CommandContext with required `_` field
// biome-ignore lint/suspicious/noExplicitAny: citty CommandContext arg not publicly typed
function ctx(args: Record<string, unknown>, cmd: unknown): any {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

describe("profileListCommand.run", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
  });

  it("lists scope files in human mode", async () => {
    const { stdout } = await captureOutput(() =>
      profileListCommand.run?.(
        ctx({ home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: false }, profileListCommand)
      )
    );
    expect(stdout).toContain("SCOPE");
    expect(stdout).toContain("ROLE");
  });

  it("lists scope files in JSON mode", async () => {
    const { stdout } = await captureOutput(() =>
      profileListCommand.run?.(
        ctx({ home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: true }, profileListCommand)
      )
    );
    const parsed = JSON.parse(stdout) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("filters by role when --role is specified", async () => {
    const { stdout } = await captureOutput(() =>
      profileListCommand.run?.(
        ctx(
          { home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: true, role: "backend" },
          profileListCommand
        )
      )
    );
    const parsed = JSON.parse(stdout) as Array<{ role: string; scope: string }>;
    // All role scopes should be backend (shared scopes use "—")
    for (const entry of parsed) {
      if (entry.scope !== "global-shared" && entry.scope !== "project-shared") {
        expect(entry.role).toBe("backend");
      }
    }
  });
});

describe("profileValidateCommand.run", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
  });

  it("validates all discovered fixture scopes in human mode", async () => {
    const { stdout } = await captureOutput(() =>
      profileValidateCommand.run?.(
        ctx({ home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: false }, profileValidateCommand)
      )
    );
    expect(stdout).toContain("[✓]");
  });

  it("validates all discovered fixture scopes in JSON mode", async () => {
    const { stdout } = await captureOutput(() =>
      profileValidateCommand.run?.(
        ctx({ home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: true }, profileValidateCommand)
      )
    );
    const parsed = JSON.parse(stdout) as { results: unknown[]; allValid: boolean };
    expect(parsed.allValid).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it("validates a specific valid file path", async () => {
    const filePath = join(FIXTURES_HOME, "config/global/shared.yml");
    const { stdout } = await captureOutput(() =>
      profileValidateCommand.run?.(
        ctx(
          { home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: false, path: filePath },
          profileValidateCommand
        )
      )
    );
    expect(stdout).toContain("[✓]");
  });

  it("reports invalid file in human mode", async () => {
    const invalidFile = join(tempDir, "invalid.yml");
    writeFileSync(invalidFile, "version: 1\nmcpServers:\n  bad:\n    type: stdio\n");
    // Mock process.exit to avoid Vitest intercepting it
    const origExit = process.exit;
    process.exit = ((_code?: number) => {
      // noop — just prevent actual exit
    }) as typeof process.exit;
    let result: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
    try {
      result = await captureOutput(() =>
        profileValidateCommand.run?.(
          ctx(
            { home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: false, path: invalidFile },
            profileValidateCommand
          )
        )
      );
    } finally {
      process.exit = origExit;
    }
    expect(result.stderr).toContain("[✗]");
  });

  it("throws CliError for nonexistent file path", () => {
    expect(() =>
      profileValidateCommand.run?.(
        ctx(
          { home: FIXTURES_HOME, cwd: FIXTURES_HOME, json: false, path: "/nonexistent/file.yml" },
          profileValidateCommand
        )
      )
    ).toThrow(CliError);
  });

  it("returns empty result when no scope files found", async () => {
    const { stdout } = await captureOutput(() =>
      profileValidateCommand.run?.(
        ctx({ home: "/nonexistent", cwd: "/nonexistent", json: false }, profileValidateCommand)
      )
    );
    expect(stdout).toContain("No scope files found");
  });

  it("returns empty JSON result when no scope files found", async () => {
    const { stdout } = await captureOutput(() =>
      profileValidateCommand.run?.(
        ctx({ home: "/nonexistent", cwd: "/nonexistent", json: true }, profileValidateCommand)
      )
    );
    const parsed = JSON.parse(stdout) as { results: unknown[]; allValid: boolean };
    expect(parsed.allValid).toBe(true);
    expect(parsed.results).toEqual([]);
  });
});

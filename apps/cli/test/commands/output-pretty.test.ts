/**
 * Sprint 10 regression tests: `--pretty` flag on top-level commands with
 * `--json` output. (Sessions commands have their own regression tests in
 * `sessions-gc-safety.test.ts`.)
 *
 * Commands covered:
 *   - version
 *   - doctor
 *   - profile list
 *   - profile validate
 *   - profile create
 *   - auth list
 *
 * Every test verifies:
 *   1. `--pretty` produces multi-line / indented JSON (contains "\n  ").
 *   2. `--pretty` alone (without `--json`) still emits JSON — it implies `--json`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAuthList } from "../../src/commands/auth/list.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { runCreate } from "../../src/commands/profile/create.js";
import { profileListCommand } from "../../src/commands/profile/list.js";
import { profileValidateCommand } from "../../src/commands/profile/validate.js";
import { versionCommand } from "../../src/commands/version.js";
import { MockBackend } from "../helpers/mock-backend.js";

const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "myclaude-pretty-"));
}

function makeExecutableClaude(): { root: string; bin: string } {
  const root = makeTempDir();
  const bin = join(root, "bin");
  const command = join(bin, "claude");
  mkdirSync(bin, { recursive: true });
  writeFileSync(command, "#!/bin/sh\nexit 0\n");
  chmodSync(command, 0o755);
  return { root, bin };
}

function ctx(args: Record<string, unknown>, cmd: unknown): unknown {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

describe("--pretty implies --json and produces indented JSON", () => {
  let stdout = "";

  beforeEach(() => {
    process.env.MYCLAUDE_FORCE_STANDALONE = "1";
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  it("version --pretty emits indented JSON", async () => {
    await versionCommand.run?.(
      ctx({ json: false, pretty: true }, versionCommand) as Parameters<
        NonNullable<typeof versionCommand.run>
      >[0]
    );
    expect(stdout).toContain('"cli"');
    expect(stdout).toContain("\n  ");
    // Parsing must still succeed.
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("doctor --pretty emits indented JSON", async () => {
    const fixture = makeExecutableClaude();
    try {
      await runDoctor({
        pretty: true,
        home: FIXTURES_HOME,
        cwd: FIXTURES_HOME,
        backend: new MockBackend("keychain-macos"),
        env: { PATH: fixture.bin, MYCLAUDE_FORCE_STANDALONE: "1" },
        claudeVersionProbe: async () => "claude 2.1.61",
      });
      expect(stdout).toContain('"checks"');
      expect(stdout).toContain("\n  ");
      expect(() => JSON.parse(stdout)).not.toThrow();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("profile list --pretty emits indented JSON", async () => {
    await profileListCommand.run?.(
      ctx(
        { json: false, pretty: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME },
        profileListCommand
      ) as Parameters<NonNullable<typeof profileListCommand.run>>[0]
    );
    expect(stdout).toContain("\n  ");
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("profile validate --pretty emits indented JSON", async () => {
    await profileValidateCommand.run?.(
      ctx(
        { json: false, pretty: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME },
        profileValidateCommand
      ) as Parameters<NonNullable<typeof profileValidateCommand.run>>[0]
    );
    expect(stdout).toContain('"results"');
    expect(stdout).toContain("\n  ");
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("profile create --pretty emits indented JSON", async () => {
    const tempDir = makeTempDir();
    try {
      await runCreate({
        role: "backend",
        global: true,
        pretty: true,
        home: tempDir,
        cwd: tempDir,
      });
      expect(stdout).toContain('"created"');
      expect(stdout).toContain("\n  ");
      expect(() => JSON.parse(stdout)).not.toThrow();
    } finally {
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("auth list --pretty emits indented JSON", async () => {
    const tempHome = makeTempDir();
    try {
      mkdirSync(join(tempHome, "config"), { recursive: true });
      const yaml = `
version: 1
authProfiles:
  work:
    displayName: "Work"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs:
      github.pat: keyring://github/work
`.trim();
      writeFileSync(join(tempHome, "config", "authProfiles.yml"), yaml);

      await runAuthList({ home: tempHome, pretty: true });

      expect(stdout).toContain('"authProfiles"');
      expect(stdout).toContain("\n  ");
      expect(() => JSON.parse(stdout)).not.toThrow();
      // Secret values must never leak.
      expect(stdout).not.toContain("sk-ant-");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

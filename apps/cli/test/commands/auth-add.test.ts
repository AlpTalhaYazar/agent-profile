/**
 * Tests for `auth add` command.
 * Uses MockBackend — never touches the real OS keychain.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuthProfiles } from "../../src/auth/profiles-file.js";
import { runAuthAdd } from "../../src/commands/auth/add.js";
import { MockBackend } from "../helpers/mock-backend.js";

describe("auth add (scripted)", () => {
  let tmpHome: string;
  let stdout: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `ap-auth-add-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpHome, "config"), { recursive: true });
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk;
      return true;
    });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("scripted happy path: creates profile and writes secret to backend", async () => {
    const backend = new MockBackend("keychain-macos");

    await runAuthAdd({
      id: "work",
      display: "Work (Acme Inc.)",
      anthropicMode: "apiKey",
      anthropicSecret: "sk-ant-test-secret",
      home: tmpHome,
      backend,
    });

    // Check metadata was written.
    const doc = loadAuthProfiles(tmpHome);
    expect(doc.authProfiles.work).toBeDefined();
    expect(doc.authProfiles.work?.displayName).toBe("Work (Acme Inc.)");
    expect(doc.authProfiles.work?.anthropic.mode).toBe("apiKey");
    expect(doc.authProfiles.work?.anthropic.secretRef).toBe("keyring://anthropic/work");

    // Check keychain received the namespaced key.
    const keys = await backend.list("agent-profile.");
    expect(keys).toContain("agent-profile.anthropic.work");

    // Confirm output message.
    expect(stdout).toContain("work");
  });

  it("fails with exit 1 if ID already exists without --force", async () => {
    const backend = new MockBackend("keychain-macos");
    // Create profile first.
    await runAuthAdd({
      id: "work",
      display: "Work",
      anthropicMode: "apiKey",
      anthropicSecret: "sk-ant-first",
      home: tmpHome,
      backend,
    });

    // Attempt to create again without --force.
    await expect(
      runAuthAdd({
        id: "work",
        display: "Work v2",
        anthropicMode: "apiKey",
        anthropicSecret: "sk-ant-second",
        home: tmpHome,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 1 });
  });

  it("overwrites with --force", async () => {
    const backend = new MockBackend("keychain-macos");
    await runAuthAdd({
      id: "work",
      anthropicMode: "apiKey",
      anthropicSecret: "sk-ant-first",
      home: tmpHome,
      backend,
    });
    await runAuthAdd({
      id: "work",
      display: "Work Updated",
      anthropicMode: "bedrock",
      anthropicSecret: "sk-ant-second",
      force: true,
      home: tmpHome,
      backend,
    });

    const doc = loadAuthProfiles(tmpHome);
    expect(doc.authProfiles.work?.anthropic.mode).toBe("bedrock");
    expect(doc.authProfiles.work?.displayName).toBe("Work Updated");
  });

  it("exits 2 for invalid ID (not matching /^[a-z0-9_-]+$/)", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthAdd({
        id: "INVALID ID",
        anthropicMode: "apiKey",
        anthropicSecret: "sk-ant-test",
        home: tmpHome,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it("exits 3 for basic-text backend without MYCLAUDE_ALLOW_PLAINTEXT", async () => {
    const backend = new MockBackend("basic-text");
    const origEnv = process.env.MYCLAUDE_ALLOW_PLAINTEXT;
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;

    await expect(
      runAuthAdd({
        id: "work",
        anthropicMode: "apiKey",
        anthropicSecret: "sk-ant-test",
        home: tmpHome,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 3 });

    if (origEnv !== undefined) {
      process.env.MYCLAUDE_ALLOW_PLAINTEXT = origEnv;
    }
  });

  it("exits 1 in non-TTY without anthropic-mode", async () => {
    const backend = new MockBackend("keychain-macos");

    // In non-TTY (vitest context), omitting anthropicMode throws
    await expect(
      runAuthAdd({
        id: "work",
        display: "Work",
        // anthropicMode intentionally omitted — non-TTY should throw
        anthropicSecret: "sk-ant-test",
        home: tmpHome,
        backend,
      })
    ).rejects.toThrow();
  });

  it("exits 1 in non-TTY without anthropic-secret (no stdin)", async () => {
    const backend = new MockBackend("keychain-macos");

    // In non-TTY (vitest context), omitting anthropicSecret and no stdin throws
    await expect(
      runAuthAdd({
        id: "work",
        display: "Work",
        anthropicMode: "apiKey",
        // anthropicSecret intentionally omitted, stdin=false — non-TTY should throw
        stdin: false,
        home: tmpHome,
        backend,
      })
    ).rejects.toThrow();
  });

  it("reads secret from stdin with --stdin flag", async () => {
    const backend = new MockBackend("keychain-macos");

    vi.spyOn(process.stdin, "on").mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "data") handler("sk-ant-stdin-secret");
        if (event === "end") handler();
        return process.stdin;
      }
    );
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);

    await runAuthAdd({
      id: "work",
      display: "Work",
      anthropicMode: "apiKey",
      stdin: true,
      home: tmpHome,
      backend,
    });

    const keys = await backend.list("agent-profile.");
    expect(keys).toContain("agent-profile.anthropic.work");
    expect(stdout).toContain("work");
  });

  it("does NOT expose secret value in output", async () => {
    const backend = new MockBackend("keychain-macos");
    const secretValue = "sk-ant-super-secret-12345";

    await runAuthAdd({
      id: "work",
      display: "Work",
      anthropicMode: "apiKey",
      anthropicSecret: secretValue,
      home: tmpHome,
      backend,
    });

    // The secret value must not appear in stdout.
    expect(stdout).not.toContain(secretValue);
  });
});

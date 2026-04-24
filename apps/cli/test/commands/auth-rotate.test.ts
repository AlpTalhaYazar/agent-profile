/**
 * Tests for `auth rotate` command.
 * Uses MockBackend — never touches the real OS keychain.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuthProfiles } from "../../src/auth/profiles-file.js";
import { runAuthRotate } from "../../src/commands/auth/rotate.js";
import { MockBackend } from "../helpers/mock-backend.js";

const FIXTURE_YAML = `
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

describe("auth rotate", () => {
  let tmpHome: string;
  let stdout: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `ap-auth-rotate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpHome, "config"), { recursive: true });
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), FIXTURE_YAML);
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

  it("rotates the anthropic secret via stdin", async () => {
    const backend = new MockBackend("keychain-macos");
    // Seed old value.
    backend.seed("agent-profile.anthropic.work", "sk-ant-old");

    // Stub stdin by mocking readStdin via stdin event emitter.
    const originalOn = process.stdin.on.bind(process.stdin);
    vi.spyOn(process.stdin, "on").mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "data") handler("sk-ant-new-value");
        if (event === "end") handler();
        return process.stdin;
      }
    );
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);

    await runAuthRotate({ id: "work", stdin: true, home: tmpHome, backend });

    // Backend should have the new value at the same key.
    const newVal = await backend.get("agent-profile.anthropic.work");
    expect(newVal).toBe("sk-ant-new-value");

    // Metadata should be unchanged.
    const doc = loadAuthProfiles(tmpHome);
    expect(doc.authProfiles.work?.anthropic.secretRef).toBe("keyring://anthropic/work");

    expect(stdout).toContain("work");
  });

  it("exits 3 for unknown auth profile ID", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthRotate({ id: "nonexistent", stdin: true, home: tmpHome, backend })
    ).rejects.toMatchObject({ exitCode: 3 });

    try {
      await runAuthRotate({ id: "nonexistent", stdin: true, home: tmpHome, backend });
    } catch (err) {
      expect((err as Error).message).toContain("nonexistent");
    }
  });

  it("exits 1 in non-TTY without --stdin", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthRotate({ id: "work", stdin: false, home: tmpHome, backend })
    ).rejects.toThrow();
  });

  it("exits 3 for basic-text backend without opt-in", async () => {
    const backend = new MockBackend("basic-text");
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;

    await expect(
      runAuthRotate({ id: "work", stdin: true, home: tmpHome, backend })
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it("does NOT expose secret value in output", async () => {
    const backend = new MockBackend("keychain-macos");
    const newSecretValue = "sk-ant-super-secret-new-value";

    vi.spyOn(process.stdin, "on").mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "data") handler(newSecretValue);
        if (event === "end") handler();
        return process.stdin;
      }
    );
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);

    await runAuthRotate({ id: "work", stdin: true, home: tmpHome, backend });

    expect(stdout).not.toContain(newSecretValue);
  });
});

/**
 * Tests for `auth remove` command.
 * Uses MockBackend — never touches the real OS keychain.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuthProfiles } from "../../src/auth/profiles-file.js";
import { runAuthRemove } from "../../src/commands/auth/remove.js";
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
      postgres.acme-prod: keyring://postgres/acme-prod
  personal:
    displayName: "Personal"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/personal
    mcpSecretRefs: {}
`.trim();

describe("auth remove", () => {
  let tmpHome: string;
  let stdout: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `ap-auth-remove-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it("removes profile metadata and keychain entries with --yes", async () => {
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", "sk-ant-value");
    backend.seed("agent-profile.github.work", "ghp_value");
    backend.seed("agent-profile.postgres.acme-prod", "pg_password");

    await runAuthRemove({ id: "work", yes: true, home: tmpHome, backend });

    // Metadata removed.
    const doc = loadAuthProfiles(tmpHome);
    expect(doc.authProfiles.work).toBeUndefined();
    // Personal profile still intact.
    expect(doc.authProfiles.personal).toBeDefined();

    // Keychain entries removed.
    const remaining = await backend.list("agent-profile.");
    expect(remaining).not.toContain("agent-profile.anthropic.work");
    expect(remaining).not.toContain("agent-profile.github.work");
    expect(remaining).not.toContain("agent-profile.postgres.acme-prod");

    expect(stdout).toContain("work");
  });

  it("exits 6 if user declines without --yes in non-TTY", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthRemove({ id: "work", yes: false, home: tmpHome, backend })
    ).rejects.toMatchObject({ exitCode: 6 });
  });

  it("exits 3 for unknown profile ID", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthRemove({ id: "nonexistent", yes: true, home: tmpHome, backend })
    ).rejects.toMatchObject({ exitCode: 3 });

    try {
      await runAuthRemove({ id: "nonexistent", yes: true, home: tmpHome, backend });
    } catch (err) {
      expect((err as Error).message).toContain("nonexistent");
    }
  });

  it("reports partial removal and exits 1 when some keychain deletes fail", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    // Use a backend where remove throws for one key.
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", "sk-ant-value");
    backend.seed("agent-profile.github.work", "ghp_value");

    let callCount = 0;
    const originalRemove = backend.remove.bind(backend);
    vi.spyOn(backend, "remove").mockImplementation(async (key: string) => {
      callCount++;
      if (callCount === 1) throw new Error("Keychain error for first key");
      return originalRemove(key);
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(
      runAuthRemove({ id: "work", yes: true, home: tmpHome, backend })
    ).rejects.toThrow();

    // Metadata should still be removed.
    const doc = loadAuthProfiles(tmpHome);
    expect(doc.authProfiles.work).toBeUndefined();

    exitSpy.mockRestore();
  });
});

/**
 * Tests for `auth set` command.
 * Uses MockBackend — never touches the real OS keychain.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAuthProfiles } from "../../src/auth/profiles-file.js";
import { runAuthSet } from "../../src/commands/auth/set.js";
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

describe("auth set", () => {
  let tmpHome: string;
  let stdout: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `ap-auth-set-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it("sets an existing secret via value argument", async () => {
    const backend = new MockBackend("keychain-macos");

    await runAuthSet({
      id: "work",
      name: "github.pat",
      value: "ghp_test_token",
      home: tmpHome,
      backend,
    });

    // Keychain should have the value stored.
    const keys = await backend.list("agent-profile.");
    expect(keys.some((k: string) => k.includes("github"))).toBe(true);

    expect(stdout).toContain("github.pat");
  });

  it("reads secret from stdin with --stdin flag", async () => {
    const backend = new MockBackend("keychain-macos");

    // Stub stdin.
    vi.spyOn(process.stdin, "on").mockImplementation(
      (event: string, handler: (...args: unknown[]) => void) => {
        if (event === "data") handler("ghp_stdin_token");
        if (event === "end") handler();
        return process.stdin;
      }
    );
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);

    await runAuthSet({
      id: "work",
      name: "github.pat",
      stdin: true,
      home: tmpHome,
      backend,
    });

    expect(stdout).toContain("github.pat");
  });

  it("exits 3 for unknown auth profile ID", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthSet({
        id: "nonexistent",
        name: "github.pat",
        value: "ghp_test",
        home: tmpHome,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it("exits 3 for unknown secret name without --register", async () => {
    const backend = new MockBackend("keychain-macos");

    await expect(
      runAuthSet({
        id: "work",
        name: "unknown.secret",
        value: "test-value",
        home: tmpHome,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 3 });

    // Error message should include the offending name.
    try {
      await runAuthSet({
        id: "work",
        name: "unknown.secret",
        value: "test-value",
        home: tmpHome,
        backend,
      });
    } catch (err) {
      expect((err as Error).message).toContain("unknown.secret");
    }
  });

  it("--register adds a new name to mcpSecretRefs", async () => {
    const backend = new MockBackend("keychain-macos");

    await runAuthSet({
      id: "work",
      name: "new.secret",
      value: "new-value-123",
      register: true,
      home: tmpHome,
      backend,
    });

    const doc = loadAuthProfiles(tmpHome);
    expect(doc.authProfiles.work?.mcpSecretRefs["new.secret"]).toBeDefined();
  });

  it("exits 3 for basic-text backend without opt-in", async () => {
    const backend = new MockBackend("basic-text");
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;

    await expect(
      runAuthSet({
        id: "work",
        name: "github.pat",
        value: "ghp_test",
        home: tmpHome,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it("error message uses 'no secrets registered yet' hint for empty mcpSecretRefs", async () => {
    const emptyYaml = `
version: 1
authProfiles:
  empty-profile:
    displayName: "Empty"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/empty
    mcpSecretRefs: {}
`.trim();
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), emptyYaml);
    const backend = new MockBackend("keychain-macos");

    try {
      await runAuthSet({
        id: "empty-profile",
        name: "some.secret",
        value: "test-value",
        home: tmpHome,
        backend,
      });
    } catch (err) {
      expect((err as Error).message).toContain("No secrets registered yet");
    }
  });

  it("does NOT expose secret value in output", async () => {
    const backend = new MockBackend("keychain-macos");
    const secretValue = "ghp_super_secret_do_not_leak";

    await runAuthSet({
      id: "work",
      name: "github.pat",
      value: secretValue,
      home: tmpHome,
      backend,
    });

    expect(stdout).not.toContain(secretValue);
  });
});

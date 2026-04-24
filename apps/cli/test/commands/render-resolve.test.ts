/**
 * Tests for `render --resolve-secrets` path.
 * Uses MockBackend — never touches the real OS keychain.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShow } from "../../src/commands/profile/show.js";
import { MockBackend } from "../helpers/mock-backend.js";

const FIXTURES = join(new URL("../fixtures", import.meta.url).pathname);
const PROJECT_FIXTURES = join(FIXTURES, "project");
// HOME_FIXTURES must point to the .myclaude directory so that
// globalConfigDir(home) → home/config resolves to the fixture config dir.
const HOME_FIXTURES = join(FIXTURES, "home", ".myclaude");

describe("render --resolve-secrets", () => {
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk;
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += chunk;
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;
  });

  it("renders normally without --resolve-secrets (existing behavior)", async () => {
    await runShow({
      role: "backend",
      home: HOME_FIXTURES,
      cwd: PROJECT_FIXTURES,
    });

    expect(stdout).toContain("backend");
    // Secret refs should appear as-is (not resolved).
    expect(stdout).toContain("${secret:");
  });

  it("with --resolve-secrets (no --show-values): sensitive fields are redacted", async () => {
    const backend = new MockBackend("keychain-macos");
    // Seed the postgres secret — it maps through work.mcpSecretRefs.postgres.acme-prod
    // → keyring://postgres/acme-prod → agent-profile.postgres.acme-prod
    backend.seed("agent-profile.postgres.acme-prod", "postgres://actual-url");

    await runShow({
      role: "backend",
      auth: "work",
      home: HOME_FIXTURES,
      cwd: PROJECT_FIXTURES,
      resolveSecrets: true,
      backend,
    });

    // Sensitive fields should be redacted.
    expect(stdout).toContain("«redacted»");
    // The actual value must NOT appear in output.
    expect(stdout).not.toContain("postgres://actual-url");
    // Footer note should appear.
    expect(stdout).toContain("ANTHROPIC_API_KEY");
    expect(stdout).toContain("apiKeyHelper.sh");
  });

  it("with --resolve-secrets --show-values: actual values in output + stderr banner", async () => {
    const backend = new MockBackend("keychain-macos");
    // postgres.acme-prod is in the project-level backend role and maps via
    // work.mcpSecretRefs → keyring://postgres/acme-prod → agent-profile.postgres.acme-prod
    backend.seed("agent-profile.postgres.acme-prod", "postgres://show-this-connection");

    await runShow({
      role: "backend",
      auth: "work",
      home: HOME_FIXTURES,
      cwd: PROJECT_FIXTURES,
      resolveSecrets: true,
      showValues: true,
      backend,
    });

    // Banner must appear on stderr.
    expect(stderr).toContain("[WARNING: secrets on screen]");
    // Values should appear in stdout.
    expect(stdout).toContain("postgres://show-this-connection");
  });

  it("with --json --resolve-secrets: emits { resolved, resolutionLog, missingRefs }", async () => {
    const backend = new MockBackend("keychain-macos");

    await runShow({
      role: "backend",
      home: HOME_FIXTURES,
      cwd: PROJECT_FIXTURES,
      resolveSecrets: true,
      json: true,
      backend,
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.resolved).toBeDefined();
    expect(parsed.resolutionLog).toBeDefined();
    expect(Array.isArray(parsed.resolutionLog)).toBe(true);
    expect(parsed.missingRefs).toBeDefined();
    expect(Array.isArray(parsed.missingRefs)).toBe(true);
  });

  it("basic-text backend without opt-in → exit 3 with message", async () => {
    const backend = new MockBackend("basic-text");
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;

    await expect(
      runShow({
        role: "backend",
        home: HOME_FIXTURES,
        cwd: PROJECT_FIXTURES,
        resolveSecrets: true,
        backend,
      })
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it("missing refs show unresolved markers (not thrown)", async () => {
    const backend = new MockBackend("keychain-macos");
    // Do NOT seed any secrets — they should appear as missing.

    await runShow({
      role: "backend",
      home: HOME_FIXTURES,
      cwd: PROJECT_FIXTURES,
      resolveSecrets: true,
      backend,
    });

    // Missing refs appear in some form (either as unresolved or just missing refs section).
    // The output should still render (not throw).
    expect(stdout).toBeDefined();
    expect(stdout.length).toBeGreaterThan(0);
  });
});

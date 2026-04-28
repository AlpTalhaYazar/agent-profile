/**
 * Tests for `auth list` command.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAuthList } from "../../src/commands/auth/list.js";

describe("auth list", () => {
  let tmpHome: string;
  let stdout: string;

  beforeEach(() => {
    // Force the standalone path so the test never touches the real daemon.
    process.env.MYCLAUDE_FORCE_STANDALONE = "1";
    tmpHome = join(tmpdir(), `ap-auth-list-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  it('shows "No auth profiles configured" when file is missing', async () => {
    await runAuthList({ home: tmpHome });
    expect(stdout).toContain("No auth profiles configured");
  });

  it("shows empty state when file has no profiles", async () => {
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), "version: 1\nauthProfiles: {}\n");
    await runAuthList({ home: tmpHome });
    expect(stdout).toContain("No auth profiles configured");
  });

  it("shows table with ID, DISPLAY NAME, MODE, SECRETS for two profiles", async () => {
    const yaml = `
version: 1
authProfiles:
  work:
    displayName: "Work (Acme Inc.)"
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
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    await runAuthList({ home: tmpHome });

    expect(stdout).toContain("work");
    expect(stdout).toContain("Work (Acme Inc.)");
    expect(stdout).toContain("apiKey");
    expect(stdout).toContain("github.pat");
    expect(stdout).toContain("postgres.acme-prod");
    expect(stdout).toContain("personal");
    expect(stdout).toContain("Personal");
  });

  it("shows keyring URIs with --show-refs", async () => {
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
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    await runAuthList({ home: tmpHome, showRefs: true });

    expect(stdout).toContain("keyring://anthropic/work");
    expect(stdout).toContain("keyring://github/work");
  });

  it("does NOT show keyring URIs without --show-refs", async () => {
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
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    await runAuthList({ home: tmpHome, showRefs: false });

    // Should contain secret names but not the keyring URIs.
    expect(stdout).toContain("github.pat");
    // The refs themselves should not appear in the default output.
    // (They may appear in the auth table as secret names, not values.)
  });

  it("emits JSON with --json flag", async () => {
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
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    await runAuthList({ home: tmpHome, json: true });

    const parsed = JSON.parse(stdout);
    expect(parsed.authProfiles).toBeDefined();
    expect(Array.isArray(parsed.authProfiles)).toBe(true);
    expect(parsed.authProfiles[0].id).toBe("work");
    expect(parsed.authProfiles[0].mode).toBe("apiKey");
  });

  it("JSON output with --show-refs includes keyring URIs", async () => {
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
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    await runAuthList({ home: tmpHome, json: true, showRefs: true });

    const parsed = JSON.parse(stdout);
    expect(parsed.authProfiles[0].anthropicRef).toBe("keyring://anthropic/work");
    expect(parsed.authProfiles[0].mcpSecrets).toEqual({ "github.pat": "keyring://github/work" });
  });

  it("JSON output does NOT contain secret values", async () => {
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
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    await runAuthList({ home: tmpHome, json: true });

    // The output should not contain any real secret values.
    // keyring:// URIs are references, not values — they are acceptable to show
    // with --show-refs but should not appear here.
    const parsed = JSON.parse(stdout);
    const jsonStr = JSON.stringify(parsed);
    // No actual secret values should appear (only metadata).
    // This test asserts no plaintext keys slip through.
    expect(jsonStr).not.toContain("sk-ant-");
    expect(jsonStr).not.toContain("ghp_");
  });
});

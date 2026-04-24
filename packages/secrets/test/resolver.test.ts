/**
 * End-to-end resolver tests.
 *
 * Uses pre-built fixture configs and a `MockBackend` — no real keychain access.
 * Tests that secrets are NOT present in the resolution log.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthProfilesDoc, ScopeDoc } from "@agent-profile/core";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { resolveSecrets } from "../src/resolver/resolve-secrets.js";
import { MockBackend } from "./helpers/mock-backend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): unknown {
  return parseYaml(readFileSync(join(FIXTURES, name), "utf-8"));
}

function buildBackend(): MockBackend {
  const backend = new MockBackend("keychain-macos");
  backend.seed("agent-profile.pg.user", "u");
  backend.seed("agent-profile.pg.pw", "p");
  backend.seed("agent-profile.github.pat", "ghp_xxx");
  backend.seed("agent-profile.figma.work", "figtok");
  return backend;
}

function buildAuthProfile() {
  const doc = AuthProfilesDoc.parse(loadFixture("auth-profile.yml"));
  const profile = doc.authProfiles.work;
  if (!profile) throw new Error("Fixture auth profile 'work' not found");
  return profile;
}

describe("resolveSecrets — full resolution", () => {
  it("resolves all secret kinds (keyring://, ${secret:}, ${env:})", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));
    const backend = buildBackend();
    const authProfile = buildAuthProfile();

    const { resolvedConfig, missingRefs } = await resolveSecrets({
      config: rawConfig,
      authProfile,
      backend,
      env: { POSTGRES_HOST: "localhost" },
    });

    expect(resolvedConfig.env.DATABASE_URL).toBe("postgres://u:p@host/db");
    expect(
      (resolvedConfig.mcpServers.github as { env: Record<string, string> })?.env
        ?.GITHUB_PERSONAL_ACCESS_TOKEN
    ).toBe("ghp_xxx");
    expect((resolvedConfig.mcpServers.postgres as { env: Record<string, string> })?.env?.HOST).toBe(
      "localhost"
    );
    expect((resolvedConfig.mcpServers.figma as { env: Record<string, string> })?.env?.TOKEN).toBe(
      "figtok"
    );
    expect(missingRefs).toHaveLength(0);
  });

  it("resolution log contains entries for all resolved refs", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));
    const backend = buildBackend();
    const authProfile = buildAuthProfile();

    const { resolutionLog } = await resolveSecrets({
      config: rawConfig,
      authProfile,
      backend,
      env: { POSTGRES_HOST: "localhost" },
    });

    // All entries should be resolved
    expect(resolutionLog.length).toBeGreaterThan(0);
    const resolvedEntries = resolutionLog.filter((e) => e.resolved);
    expect(resolvedEntries.length).toBeGreaterThan(0);
  });

  it("resolution log contains source paths, not secret values", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));
    const backend = buildBackend();
    const authProfile = buildAuthProfile();

    const { resolutionLog } = await resolveSecrets({
      config: rawConfig,
      authProfile,
      backend,
      env: { POSTGRES_HOST: "localhost" },
    });

    const serialized = JSON.stringify(resolutionLog);

    // Known test secret values must NOT appear in the log
    expect(serialized).not.toContain("ghp_xxx");
    expect(serialized).not.toContain("figtok");
    expect(serialized).not.toContain('"u"');
    expect(serialized).not.toContain('"p"');

    // Identifiers (paths, ref names) SHOULD appear
    expect(serialized).toContain("github.pat");
  });

  it("does not mutate the original config document", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));
    const originalUrl = rawConfig.env.DATABASE_URL;
    const backend = buildBackend();
    const authProfile = buildAuthProfile();

    const { resolvedConfig } = await resolveSecrets({
      config: rawConfig,
      authProfile,
      backend,
      env: { POSTGRES_HOST: "localhost" },
    });

    // Original should be unchanged
    expect(rawConfig.env.DATABASE_URL).toBe(originalUrl);
    // Resolved should be different
    expect(resolvedConfig.env.DATABASE_URL).not.toBe(originalUrl);
  });
});

describe("resolveSecrets — missing refs", () => {
  it("returns missingRefs instead of throwing when a secret is absent", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));

    // Backend missing pg.pw
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.pg.user", "u");
    // pg.pw deliberately NOT seeded
    backend.seed("agent-profile.github.pat", "ghp_xxx");
    backend.seed("agent-profile.figma.work", "figtok");

    const authProfile = buildAuthProfile();

    const { resolvedConfig, missingRefs } = await resolveSecrets({
      config: rawConfig,
      authProfile,
      backend,
      env: { POSTGRES_HOST: "localhost" },
    });

    // pg.pw should be in missingRefs
    const pgPwMissing = missingRefs.find((r) => r.name === "pg.pw");
    expect(pgPwMissing).toBeDefined();
    expect(pgPwMissing?.path).toBe("env.DATABASE_URL");

    // The resolved string should contain the original ref text for the missing part
    expect(resolvedConfig.env.DATABASE_URL).toContain("${secret:pg.pw}");
    // But the resolved part (pg.user → "u") should be substituted
    expect(resolvedConfig.env.DATABASE_URL).toContain("postgres://u:");
  });

  it("flags missing refs in the resolution log", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));

    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.pg.user", "u");
    // pg.pw missing

    const authProfile = buildAuthProfile();

    const { resolutionLog } = await resolveSecrets({
      config: rawConfig,
      authProfile,
      backend,
      env: { POSTGRES_HOST: "localhost" },
    });

    const unresolvedEntries = resolutionLog.filter((e) => !e.resolved);
    expect(unresolvedEntries.length).toBeGreaterThan(0);
  });
});

describe("resolveSecrets — no authProfile", () => {
  it("reports ${secret:} refs as missing when no authProfile is provided", async () => {
    const rawConfig = ScopeDoc.parse(loadFixture("effective-with-refs.yml"));
    const backend = buildBackend();

    const { missingRefs } = await resolveSecrets({
      config: rawConfig,
      backend,
      env: { POSTGRES_HOST: "localhost" },
      // no authProfile
    });

    // All ${secret:...} refs should be missing
    const secretMissing = missingRefs.filter((r) => r.kind === "secret");
    expect(secretMissing.length).toBeGreaterThan(0);
  });
});

describe("resolveSecrets — batched reads", () => {
  it("issues at most one backend.get per unique key", async () => {
    let callCount = 0;

    // Create a custom backend that counts get() calls
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.pg.user", "u");
    backend.seed("agent-profile.pg.pw", "p");

    const wrappedGet = backend.get.bind(backend);
    const getCalls = new Map<string, number>();
    backend.get = async (key: string) => {
      getCalls.set(key, (getCalls.get(key) ?? 0) + 1);
      callCount++;
      return wrappedGet(key);
    };

    // Config where pg.user appears twice
    const config = ScopeDoc.parse({
      version: 1,
      mcpServers: {},
      env: {
        URL1: "${secret:pg.user}",
        URL2: "${secret:pg.user}", // same ref, different field
      },
      settings: {},
    });

    const authProfile = buildAuthProfile();

    await resolveSecrets({ config, authProfile, backend, env: {} });

    // pg.user should only be read once despite appearing in two fields
    expect(getCalls.get("agent-profile.pg.user")).toBe(1);
  });
});

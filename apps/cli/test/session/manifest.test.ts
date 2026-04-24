import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthProfilesDocT, EffectiveConfig } from "@agent-profile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractMcpHeaders,
  generateCapabilityToken,
  writeSessionManifest,
} from "../../src/session/manifest.js";

const EXPECTED_MANIFEST_KEYS = [
  "version",
  "sessionId",
  "capabilityToken",
  "authProfileId",
  "anthropic",
  "mcpHeaders",
  "mcpSecretRefs",
];

function authProfiles(): AuthProfilesDocT {
  return {
    version: 1,
    authProfiles: {
      work: {
        displayName: "Work",
        anthropic: {
          mode: "apiKey",
          secretRef: "keyring://anthropic/work",
        },
        mcpSecretRefs: {
          "github.pat": "keyring://github/work",
          "postgres.url": "keyring://postgres/work",
        },
      },
      personal: {
        anthropic: {
          mode: "bedrock",
          secretRef: "keyring://anthropic/personal",
        },
        mcpSecretRefs: {},
      },
    },
  };
}

function effectiveConfig(): Pick<EffectiveConfig, "auth" | "mcpServers"> {
  return {
    auth: { profileId: "work" },
    mcpServers: {
      github: {
        type: "http",
        url: "https://mcp.github.example",
        headers: {
          Authorization: "Bearer ${secret:github.pat}",
          "X-Workspace": "acme",
        },
        enabled: true,
        __merge: "replace",
      },
      postgres: {
        type: "stdio",
        command: "postgres-mcp",
        args: [],
        env: {
          DATABASE_URL: "${secret:postgres.url}",
        },
        enabled: true,
        __merge: "replace",
      },
      figma: {
        type: "sse",
        url: "https://mcp.figma.example/sse",
        headers: {},
        enabled: true,
        __merge: "replace",
      },
    },
  };
}

describe("generateCapabilityToken", () => {
  it("generates a 43-char unpadded base64url token from 32 random bytes", () => {
    expect(generateCapabilityToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("extractMcpHeaders", () => {
  it("extracts only MCP server headers that are record<string,string>", () => {
    const effective = {
      mcpServers: {
        remote: {
          type: "http",
          url: "https://remote.example",
          headers: { Authorization: "Bearer ${secret:remote.token}" },
          enabled: true,
        },
        empty: {
          type: "sse",
          url: "https://empty.example/sse",
          headers: {},
          enabled: true,
        },
        malformed: {
          type: "http",
          url: "https://bad.example",
          headers: { Authorization: 123 },
          enabled: true,
        },
        stdio: {
          type: "stdio",
          command: "tool",
          args: [],
          env: {},
          enabled: true,
        },
      },
    } satisfies { mcpServers: Record<string, unknown> };

    expect(extractMcpHeaders(effective as unknown as Pick<EffectiveConfig, "mcpServers">)).toEqual({
      remote: { Authorization: "Bearer ${secret:remote.token}" },
      empty: {},
    });
  });
});

describe("writeSessionManifest", () => {
  let tmpRoot: string;
  let sessionDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `ap-cli-session-manifest-${Date.now()}-${Math.random()}`);
    sessionDir = join(tmpRoot, "sessions", "session-123");
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("writes exactly the helper SessionManifest fields with refs and header templates", async () => {
    const result = await writeSessionManifest({
      sessionDir,
      sessionId: "session-123",
      effective: effectiveConfig(),
      authProfiles: authProfiles(),
    });

    const raw = await readFile(result.manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(result.manifestPath).toBe(join(sessionDir, "session.json"));
    expect(Object.keys(parsed)).toEqual(EXPECTED_MANIFEST_KEYS);
    expect(parsed).toEqual(result.manifest);
    expect(parsed.version).toBe(1);
    expect(parsed.sessionId).toBe("session-123");
    expect(parsed.capabilityToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parsed.authProfileId).toBe("work");
    expect(parsed.anthropic).toEqual({
      mode: "apiKey",
      secretRef: "keyring://anthropic/work",
    });
    expect(parsed.mcpHeaders).toEqual({
      github: {
        Authorization: "Bearer ${secret:github.pat}",
        "X-Workspace": "acme",
      },
      figma: {},
    });
    expect(parsed.mcpSecretRefs).toEqual({
      "github.pat": "keyring://github/work",
      "postgres.url": "keyring://postgres/work",
    });
    expect(raw).not.toContain("ghp_secret_value");
    expect(raw).not.toContain("postgres://secret-value");
  });

  it("uses an explicit auth profile id when provided", async () => {
    const result = await writeSessionManifest({
      sessionDir,
      sessionId: "session-123",
      effective: effectiveConfig(),
      authProfiles: authProfiles(),
      authProfileId: "personal",
      capabilityToken: "fixed-token",
    });

    expect(result.capabilityToken).toBe("fixed-token");
    expect(result.manifest.capabilityToken).toBe("fixed-token");
    expect(result.manifest.authProfileId).toBe("personal");
    expect(result.manifest.anthropic).toEqual({
      mode: "bedrock",
      secretRef: "keyring://anthropic/personal",
    });
    expect(result.manifest.mcpSecretRefs).toEqual({});
  });

  it("writes with mode 0600 via temp file and rename", async () => {
    const { manifestPath } = await writeSessionManifest({
      sessionDir,
      sessionId: "session-123",
      effective: effectiveConfig(),
      authProfiles: authProfiles(),
    });

    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(sessionDir).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("throws when no auth profile is bound", async () => {
    const { auth: _auth, ...effectiveWithoutAuth } = effectiveConfig();

    await expect(
      writeSessionManifest({
        sessionDir,
        sessionId: "session-123",
        effective: effectiveWithoutAuth,
        authProfiles: authProfiles(),
      })
    ).rejects.toMatchObject({
      exitCode: 2,
      message: "Session manifest requires an auth profile",
    });
    expect(existsSync(join(sessionDir, "session.json"))).toBe(false);
  });

  it("throws when the auth profile id does not exist", async () => {
    await expect(
      writeSessionManifest({
        sessionDir,
        sessionId: "session-123",
        effective: effectiveConfig(),
        authProfiles: authProfiles(),
        authProfileId: "missing",
      })
    ).rejects.toMatchObject({
      exitCode: 2,
      message: 'Auth profile "missing" was not found for session manifest',
    });
    expect(existsSync(join(sessionDir, "session.json"))).toBe(false);
  });
});

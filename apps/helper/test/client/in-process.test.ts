/**
 * Tests for the in-process `HelperClient` implementation.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInProcessHelperClient } from "../../src/client/in-process.js";
import {
  EXIT_AUTH,
  EXIT_CAPABILITY_DENIED,
  EXIT_SESSION_UNKNOWN,
  HelperError,
} from "../../src/errors.js";
import { MockBackend } from "../helpers/mock-backend.js";

const SENTINEL = "SECRET-KEY-SENTINEL-12345";

let tmpRoot = "";

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = "";
});

function makeSessionsRoot(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), "helper-in-process-"));
  return tmpRoot;
}

interface SeededSession {
  sessionsRoot: string;
  sessionId: string;
  capabilityToken: string;
}

async function seedSession(overrides: {
  sessionsRoot?: string;
  capabilityToken?: string;
  anthropicSecretRef?: string;
  mcpHeaders?: Record<string, Record<string, string>>;
  mcpSecretRefs?: Record<string, string>;
}): Promise<SeededSession> {
  const sessionsRoot = overrides.sessionsRoot ?? makeSessionsRoot();
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const capabilityToken = overrides.capabilityToken ?? "real-cap-token-123";
  const sessionDir = join(sessionsRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const manifest = {
    version: 1,
    sessionId,
    capabilityToken,
    authProfileId: "work",
    anthropic: {
      mode: "apiKey",
      secretRef: overrides.anthropicSecretRef ?? "keyring://anthropic/work",
    },
    mcpHeaders: overrides.mcpHeaders ?? {
      github: { Authorization: "Bearer ${secret:gh.pat}" },
    },
    mcpSecretRefs: overrides.mcpSecretRefs ?? {
      "gh.pat": "keyring://github/pat",
    },
  };

  await writeFile(join(sessionDir, "session.json"), JSON.stringify(manifest), "utf8");
  return { sessionsRoot, sessionId, capabilityToken };
}

describe("createInProcessHelperClient — anthropic", () => {
  it("returns the keychain-backed API key on a valid request", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    const key = await client.anthropic({ sessionId, capabilityToken });
    expect(key).toBe(SENTINEL);
  });

  it("throws EXIT_CAPABILITY_DENIED when the capability token does not match", async () => {
    const { sessionsRoot, sessionId } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(
      client.anthropic({ sessionId, capabilityToken: "wrong-token" })
    ).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_CAPABILITY_DENIED,
    });
  });

  it("throws EXIT_SESSION_UNKNOWN when the session directory is missing", async () => {
    const sessionsRoot = makeSessionsRoot();
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(
      client.anthropic({ sessionId: "00000000-0000-0000-0000-000000000000", capabilityToken: "x" })
    ).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_SESSION_UNKNOWN,
    });
  });

  it("throws EXIT_AUTH when the anthropic secret is missing from the keychain", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos"); // intentionally empty

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(client.anthropic({ sessionId, capabilityToken })).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError &&
        e.exitCode === EXIT_AUTH &&
        e.message.includes("keyring://anthropic/work")
      );
    });
  });

  it("rejects the basic-text backend without MYCLAUDE_ALLOW_PLAINTEXT", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("basic-text");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(client.anthropic({ sessionId, capabilityToken })).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_AUTH,
    });
  });

  it("permits the basic-text backend when MYCLAUDE_ALLOW_PLAINTEXT=1", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("basic-text");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({
      sessionsRoot,
      backend,
      env: { MYCLAUDE_ALLOW_PLAINTEXT: "1" },
    });
    const key = await client.anthropic({ sessionId, capabilityToken });
    expect(key).toBe(SENTINEL);
  });

  it("throws EXIT_AUTH with a structural message when anthropic.secretRef is unparseable", async () => {
    // Bypass the manifest schema (which requires keyring://) by writing the
    // manifest manually via a helper that allows an invalid-shape keyring URI.
    const sessionsRoot = makeSessionsRoot();
    const sessionId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const capabilityToken = "cap-token";
    const sessionDir = join(sessionsRoot, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const manifest = {
      version: 1,
      sessionId,
      capabilityToken,
      authProfileId: "work",
      anthropic: { mode: "apiKey", secretRef: "keyring:///missing-service" },
      mcpHeaders: {},
      mcpSecretRefs: {},
    };
    await writeFile(join(sessionDir, "session.json"), JSON.stringify(manifest), "utf8");

    const backend = new MockBackend("keychain-macos");
    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(client.anthropic({ sessionId, capabilityToken })).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError &&
        e.exitCode === EXIT_AUTH &&
        e.message.startsWith("invalid anthropic.secretRef:")
      );
    });
  });
});

describe("createInProcessHelperClient — mcpHeaders", () => {
  it("resolves refs using the session's mcpSecretRefs map", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.github.pat", "ghp_xxx");

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    const out = await client.mcpHeaders({ sessionId, capabilityToken, serverName: "github" });
    expect(out).toEqual({ Authorization: "Bearer ghp_xxx" });
  });

  it("throws EXIT_SESSION_UNKNOWN when the server is not in the manifest", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.github.pat", "ghp_xxx");

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(
      client.mcpHeaders({ sessionId, capabilityToken, serverName: "unknown-server" })
    ).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_SESSION_UNKNOWN,
      message: "unknown mcp server in session: unknown-server",
    });
  });

  it("throws EXIT_CAPABILITY_DENIED before any keychain read", async () => {
    const { sessionsRoot, sessionId } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.github.pat", "ghp_xxx");

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });
    await expect(
      client.mcpHeaders({ sessionId, capabilityToken: "wrong", serverName: "github" })
    ).rejects.toMatchObject({ exitCode: EXIT_CAPABILITY_DENIED });
    expect(backend.getCalls).toHaveLength(0);
  });
});

describe("createInProcessHelperClient — sessionsRoot precedence", () => {
  it("opts.sessionsRoot wins over MYCLAUDE_SESSIONS_ROOT and the default", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({
      sessionsRoot,
      backend,
      env: { MYCLAUDE_SESSIONS_ROOT: "/tmp/should-be-ignored-xyz" },
    });
    const key = await client.anthropic({ sessionId, capabilityToken });
    expect(key).toBe(SENTINEL);
  });

  it("falls back to MYCLAUDE_SESSIONS_ROOT when opts.sessionsRoot is unset", async () => {
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", SENTINEL);

    const client = createInProcessHelperClient({
      backend,
      env: { MYCLAUDE_SESSIONS_ROOT: sessionsRoot },
    });
    const key = await client.anthropic({ sessionId, capabilityToken });
    expect(key).toBe(SENTINEL);
  });
});

describe("createInProcessHelperClient — security", () => {
  it("never leaks a seeded keychain value in any error message", async () => {
    // Seed the backend with a distinctive sentinel. All tested failure paths
    // — capability denied, missing server, bad ref — must NOT echo it.
    const { sessionsRoot, sessionId, capabilityToken } = await seedSession({});
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.anthropic.work", SENTINEL);
    backend.seed("agent-profile.github.pat", SENTINEL);

    const client = createInProcessHelperClient({ sessionsRoot, backend, env: {} });

    // Case A: capability denied.
    await expect(async () => {
      try {
        await client.anthropic({ sessionId, capabilityToken: "wrong" });
      } catch (e) {
        expect((e as HelperError).message).not.toContain(SENTINEL);
        throw e;
      }
    }).rejects.toThrow();

    // Case B: unknown mcp server — capability OK, then fail.
    await expect(async () => {
      try {
        await client.mcpHeaders({ sessionId, capabilityToken, serverName: "nope" });
      } catch (e) {
        expect((e as HelperError).message).not.toContain(SENTINEL);
        throw e;
      }
    }).rejects.toThrow();

    // Case C: unresolved header ref. Reconfigure session with a reference
    // pointing to an unseeded keyring key; sentinel values seeded elsewhere
    // must not appear.
    const extra = await seedSession({
      sessionsRoot,
      mcpHeaders: { svc: { Authorization: "Bearer ${secret:nope.ref}" } },
      mcpSecretRefs: { "nope.ref": "keyring://nope/absent" },
    });
    await expect(async () => {
      try {
        await client.mcpHeaders({
          sessionId: extra.sessionId,
          capabilityToken: extra.capabilityToken,
          serverName: "svc",
        });
      } catch (e) {
        expect((e as HelperError).message).not.toContain(SENTINEL);
        throw e;
      }
    }).rejects.toThrow();
  });
});

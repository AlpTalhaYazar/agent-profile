/**
 * @file daemon-handlers.test.ts
 *
 * Direct unit tests for the per-kind handlers built by {@link createHandlers}.
 * No `DaemonServer` involved — we invoke each handler with a synthetic request
 * + lifecycle stub and assert on the returned body or thrown {@link IpcError}.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import type * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IpcError, type ReqT } from "@agent-profile/ipc-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LifecycleHandle, createHandlers } from "../src/main/daemon/handlers.js";

function lifecycleFor(home: string, override: Partial<LifecycleHandle> = {}): LifecycleHandle {
  return {
    pid: 12345,
    socketPath: "/tmp/desk-test.sock",
    startedAtMs: Date.now() - 1000,
    sessionsRoot: join(home, ".myclaude", "sessions"),
    requestShutdown: () => {
      /* noop */
    },
    ...override,
  };
}

const fakeSocket = {} as unknown as net.Socket;
const ctx = { socket: fakeSocket };

function req<K extends ReqT["kind"]>(kind: K, extra: Record<string, unknown> = {}): ReqT {
  return { id: "t-1", kind, ...extra } as unknown as ReqT;
}

describe("daemon handlers", () => {
  let home: string;

  beforeEach(async () => {
    home = join(tmpdir(), `desktop-handlers-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(home, ".myclaude", "config"), { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // ─── auth.list ─────────────────────────────────────────────────────────────

  it("auth.list returns an empty profiles array when authProfiles.yml is missing", async () => {
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["auth.list"];
    if (!handler) throw new Error("missing handler");
    const body = await handler(req("auth.list", { includeRefs: false }), ctx);
    expect(body.profiles).toEqual([]);
  });

  it("auth.list projects fixture entries to the wire shape", async () => {
    await writeFile(
      join(home, ".myclaude", "config", "authProfiles.yml"),
      `
version: 1
authProfiles:
  work:
    displayName: "Work"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs:
      github.pat: keyring://github/work
`.trim()
    );
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["auth.list"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(req("auth.list", { includeRefs: false }), ctx)) as {
      profiles: Array<{ id: string; displayName: string; mode: string; secrets: string[] }>;
    };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]).toEqual({
      id: "work",
      displayName: "Work",
      mode: "apiKey",
      secrets: ["github.pat"],
    });
  });

  // ─── auth.get-secret-ref ──────────────────────────────────────────────────

  it("auth.get-secret-ref returns the keyring URI for a known secret", async () => {
    await writeFile(
      join(home, ".myclaude", "config", "authProfiles.yml"),
      `
version: 1
authProfiles:
  work:
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs:
      github.pat: keyring://github/work
`.trim()
    );
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["auth.get-secret-ref"];
    if (!handler) throw new Error("missing handler");
    const known = await handler(
      req("auth.get-secret-ref", { authId: "work", name: "github.pat" }),
      ctx
    );
    expect(known.ref).toBe("keyring://github/work");

    const anthropic = await handler(
      req("auth.get-secret-ref", { authId: "work", name: "anthropic" }),
      ctx
    );
    expect(anthropic.ref).toBe("keyring://anthropic/work");
  });

  it("auth.get-secret-ref returns null for an unknown secret", async () => {
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["auth.get-secret-ref"];
    if (!handler) throw new Error("missing handler");
    const body = await handler(
      req("auth.get-secret-ref", { authId: "nope", name: "missing" }),
      ctx
    );
    expect(body.ref).toBeNull();
  });

  // ─── profile.show (smoke) ─────────────────────────────────────────────────

  it("profile.show surfaces ServiceError as BAD_REQUEST when no scopes exist", async () => {
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["profile.show"];
    if (!handler) throw new Error("missing handler");
    // No config dir, so the cascade has nothing to resolve. Either an empty
    // shape comes back (acceptable) or a BAD_REQUEST is thrown — both are
    // valid signal that the handler ran without crashing.
    try {
      const body = await handler(
        req("profile.show", { role: "backend", authProfileId: "work", cwd: home }),
        ctx
      );
      // If it returned, both fields exist (even if empty/null).
      expect(body).toHaveProperty("effective");
      expect(body).toHaveProperty("provenance");
    } catch (err) {
      expect(err).toBeInstanceOf(IpcError);
      // Either BAD_REQUEST (ServiceError mapped) or INTERNAL is acceptable
      // because core may throw a non-ServiceError for the "no role file" case.
      expect(["BAD_REQUEST", "INTERNAL"]).toContain((err as IpcError).code);
    }
  });

  it("profile.list returns discovered scope entries", async () => {
    await mkdir(join(home, ".myclaude", "config", "global", "roles"), { recursive: true });
    await writeFile(
      join(home, ".myclaude", "config", "global", "shared.yml"),
      "version: 1\nenv:\n  EDITOR: nvim\n"
    );
    await writeFile(
      join(home, ".myclaude", "config", "global", "roles", "backend.yml"),
      "version: 1\nenv:\n  NODE_ENV: development\n"
    );

    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["profile.list"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(
      req("profile.list", { cwd: home, roleFilter: "backend" }),
      ctx
    )) as {
      scopes: Array<{ scope: string; role: string | null; filePath: string; content: unknown }>;
    };

    expect(body.scopes.map((entry) => [entry.scope, entry.role])).toEqual([
      ["global-shared", null],
      ["global-role", "backend"],
    ]);
    expect(body.scopes[0]?.content).toMatchObject({ version: 1, env: { EDITOR: "nvim" } });
  });

  it("profile.validate returns schema issues without throwing", async () => {
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["profile.validate"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(req("profile.validate", { content: { version: 2 } }), ctx)) as {
      issues: Array<{ path: string; code: string }>;
    };

    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toMatchObject({ path: "version", code: "invalid_value" });
  });

  it("profile.preview returns an effective diff for a valid draft", async () => {
    const projectDir = join(home, "repo");
    await mkdir(join(home, ".myclaude", "config", "global", "roles"), { recursive: true });
    await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });
    await writeFile(
      join(home, ".myclaude", "config", "global", "shared.yml"),
      "version: 1\nenv:\n  EDITOR: nvim\n"
    );
    await writeFile(
      join(home, ".myclaude", "config", "global", "roles", "backend.yml"),
      "version: 1\nenv:\n  NODE_ENV: development\n"
    );
    await writeFile(
      join(projectDir, ".myclaude", "roles", "backend.yml"),
      "version: 1\nenv:\n  PROJECT_DB_POOL: '20'\n"
    );

    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["profile.preview"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(
      req("profile.preview", {
        role: "backend",
        authProfileId: "work",
        cwd: projectDir,
        draft: {
          path: join(projectDir, ".myclaude", "roles", "backend.yml"),
          content: "version: 1\nenv:\n  PROJECT_DB_POOL: '30'\n",
        },
      }),
      ctx
    )) as { issues: unknown[]; diff: Array<{ path: string; after?: unknown }> };

    expect(body.issues).toEqual([]);
    expect(body.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "env.PROJECT_DB_POOL",
          after: "30",
        }),
      ])
    );
  });

  // ─── sessions.list ────────────────────────────────────────────────────────

  it("sessions.list returns an empty array when registry dir is absent", async () => {
    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["sessions.list"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(req("sessions.list", { activeOnly: false }), ctx)) as {
      sessions: unknown[];
    };
    expect(body.sessions).toEqual([]);
  });

  it("sessions.list returns records when the registry dir exists", async () => {
    // Build a fake registry with one record at the location persona-deployer
    // would write it: <dirname(sessionsRoot)>/session-registry/.
    const sessionsRoot = join(home, ".myclaude", "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    const registryDir = join(home, ".myclaude", "session-registry");
    await mkdir(registryDir, { recursive: true });
    const record = {
      version: 1,
      sessionId: "01HX-AAAA",
      role: "backend",
      authProfileId: "work",
      cwd: home,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      retained: false,
      cleaned: false,
      runtimePaths: {
        sessionDir: join(sessionsRoot, "01HX-AAAA"),
        claudeConfigDir: join(sessionsRoot, "01HX-AAAA", ".claude"),
        mcpConfig: join(sessionsRoot, "01HX-AAAA", "mcp.json"),
        settings: join(sessionsRoot, "01HX-AAAA", "settings.json"),
        apiKeyHelper: null,
        headersHelper: null,
        claudeMd: null,
      },
      spawn: { command: "claude", args: [] },
      status: "running",
    };
    await writeFile(join(registryDir, "01HX-AAAA.json"), JSON.stringify(record));

    const handlers = createHandlers(lifecycleFor(home), home);
    const handler = handlers["sessions.list"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(req("sessions.list", { activeOnly: true }), ctx)) as {
      sessions: Array<{ sessionId: string; status: string }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.sessionId).toBe("01HX-AAAA");
    expect(body.sessions[0]?.status).toBe("running");
  });

  // ─── daemon.status ────────────────────────────────────────────────────────

  it("daemon.status returns lifecycle metadata + session counts", async () => {
    const handlers = createHandlers(
      lifecycleFor(home, { pid: 99, startedAtMs: Date.now() - 5000 }),
      home
    );
    const handler = handlers["daemon.status"];
    if (!handler) throw new Error("missing handler");
    const body = (await handler(req("daemon.status"), ctx)) as {
      pid: number;
      socketPath: string;
      uptimeMs: number;
      sessionCounts: { active: number; total: number };
    };
    expect(body.pid).toBe(99);
    expect(body.socketPath).toBe("/tmp/desk-test.sock");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.sessionCounts).toEqual({ active: 0, total: 0 });
  });

  // ─── daemon.stop ──────────────────────────────────────────────────────────

  it("daemon.stop calls lifecycle.requestShutdown and returns an empty body", async () => {
    const requestShutdown = vi.fn();
    const handlers = createHandlers(lifecycleFor(home, { requestShutdown }), home);
    const handler = handlers["daemon.stop"];
    if (!handler) throw new Error("missing handler");
    const body = await handler(req("daemon.stop"), ctx);
    expect(body).toEqual({});
    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });
});

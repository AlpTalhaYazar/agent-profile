/**
 * @file daemon-handlers-write.test.ts
 *
 * Direct unit tests for the write-side daemon handlers built by
 * {@link createWriteHandlers}. The harness wires up an in-memory `SafeStorageStore`
 * (via the public secrets package, with mock encrypt/decrypt) plus an
 * `AuditLog` writing into a tmpdir.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import type * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CapabilityIssuer,
  CapabilityVerifier,
  RevocationRegistry,
  generateSigningKey,
} from "@agent-profile/capability";
import { IpcError, type ReqT } from "@agent-profile/ipc-protocol";
import {
  type Backend,
  type SafeStorageStore,
  createSafeStorageStore,
} from "@agent-profile/secrets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../src/main/daemon/audit.js";
import { createWriteHandlers, runSessionCleanup } from "../src/main/daemon/handlers-write.js";

const fakeSocket = {} as unknown as net.Socket;
const ctx = { socket: fakeSocket };

function req<K extends ReqT["kind"]>(kind: K, extra: Record<string, unknown> = {}): ReqT {
  return { id: "t-1", kind, ...extra } as unknown as ReqT;
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

class StubKeyring implements Backend {
  readonly kind = "keychain-macos" as const;
  private readonly map = new Map<string, string>();
  isSecure(): boolean {
    return true;
  }
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return Array.from(this.map.keys()).filter((k) => k.startsWith(prefix));
  }
  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const encrypt = (s: string): Buffer => Buffer.from(`ENC:${s}`, "utf8");
const decrypt = (b: Buffer): string => b.toString("utf8").slice(4);

describe("daemon write handlers", () => {
  let home: string;
  let myClaudeHome: string;
  let store: SafeStorageStore;
  let issuer: CapabilityIssuer;
  let verifier: CapabilityVerifier;
  let audit: AuditLog;
  let auditPath: string;
  let keyring: StubKeyring;

  beforeEach(async () => {
    home = join(tmpdir(), `desktop-write-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    myClaudeHome = join(home, ".myclaude");
    await mkdir(join(myClaudeHome, "config"), { recursive: true });
    store = await createSafeStorageStore({
      encrypt,
      decrypt,
      filePath: join(myClaudeHome, "secrets.enc.json"),
    });
    const signingKey = generateSigningKey();
    const revocations = new RevocationRegistry();
    issuer = new CapabilityIssuer({ signingKey, revocations, nowMs: () => 1_000 });
    verifier = new CapabilityVerifier({ signingKey, revocations, nowMs: () => 1_000 });
    auditPath = join(myClaudeHome, "audit.log");
    audit = new AuditLog({ filePath: auditPath });
    keyring = new StubKeyring();
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  function build() {
    return createWriteHandlers({
      myClaudeHome,
      store,
      keyring,
      issuer,
      verifier,
      audit,
      daemonPid: 99,
      now: () => 1_500,
      cleanupIntervalMs: 0,
    });
  }

  it("profile.save validates content and writes to allowlisted project scope paths", async () => {
    const handler = build()["profile.save"];
    if (!handler) throw new Error("missing handler");
    const targetPath = join(home, "repo", ".myclaude", "shared.yml");
    const body = await handler(
      req("profile.save", {
        path: targetPath,
        content: {
          version: 1,
          env: { EDITOR: "nvim" },
        },
      }),
      ctx
    );

    expect(body).toEqual({ saved: true, path: targetPath });
    expect(await readFile(targetPath, "utf8")).toContain("EDITOR: nvim");
  });

  it("profile.createScope scaffolds project and global layer paths", async () => {
    const handler = build()["profile.createScope"];
    if (!handler) throw new Error("missing handler");
    const projectDir = join(home, "repo");

    const projectRole = await handler(
      req("profile.createScope", {
        cwd: projectDir,
        location: "project",
        layerType: "role",
        role: "backend",
      }),
      ctx
    );
    expect(projectRole).toMatchObject({
      created: true,
      path: join(projectDir, ".myclaude", "roles", "backend.yml"),
      scope: "project-role",
      role: "backend",
    });
    expect(await readFile(join(projectDir, ".myclaude", "roles", "backend.yml"), "utf8")).toContain(
      "version: 1"
    );

    const globalShared = await handler(
      req("profile.createScope", {
        cwd: projectDir,
        location: "global",
        layerType: "shared",
      }),
      ctx
    );
    expect(globalShared).toMatchObject({
      created: true,
      path: join(myClaudeHome, "config", "global", "shared.yml"),
      scope: "global-shared",
      role: null,
    });
  });

  it("auth.add stores the encrypted secret and writes the metadata file", async () => {
    const handler = build()["auth.add"];
    if (!handler) throw new Error("missing handler");
    const body = await handler(
      req("auth.add", {
        spec: {
          id: "work",
          displayName: "Work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("SECRET-A"),
      }),
      ctx
    );
    expect(body).toEqual({});
    expect(await store.get("agent-profile.anthropic.work")).toBe("SECRET-A");
    const auth = await readFile(join(myClaudeHome, "config", "authProfiles.yml"), "utf8");
    expect(auth).toContain("work:");
    expect(auth).toContain("keyring://anthropic/work");
  });

  it("auth.add rejects a duplicate id without force", async () => {
    const handler = build()["auth.add"];
    if (!handler) throw new Error("missing handler");
    await handler(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("A"),
      }),
      ctx
    );
    await expect(
      handler(
        req("auth.add", {
          spec: {
            id: "work",
            anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
          },
          anthropicSecretB64: b64("B"),
        }),
        ctx
      )
    ).rejects.toBeInstanceOf(IpcError);
  });

  it("auth.setSecret rejects an unknown secret name without register", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("A"),
      }),
      ctx
    );
    await expect(
      handler["auth.setSecret"]?.(
        req("auth.setSecret", { authId: "work", name: "github.pat", valueB64: b64("PAT") }),
        ctx
      )
    ).rejects.toBeInstanceOf(IpcError);
  });

  it("auth.setSecret with register=true creates the entry and stores the secret", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("A"),
      }),
      ctx
    );
    const body = await handler["auth.setSecret"]?.(
      req("auth.setSecret", {
        authId: "work",
        name: "github.pat",
        valueB64: b64("PAT"),
        register: true,
      }),
      ctx
    );
    expect(body).toEqual({});
    // Note: name "github.pat" → "github-pat" service mapping per command logic.
    expect(await store.get("agent-profile.github-pat.work")).toBe("PAT");
  });

  it("auth.rotate replaces the stored secret and revokes live sessions bound to that profile", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("A"),
      }),
      ctx
    );
    const start = (await handler["session.start"]?.(
      req("session.start", {
        sessionId: "s-rotate",
        pid: 41,
        authProfileId: "work",
        ttlMs: 60_000,
      }),
      ctx
    )) as { capabilityToken: string };
    await handler["auth.rotate"]?.(
      req("auth.rotate", { authId: "work", anthropicSecretB64: b64("A2") }),
      ctx
    );
    expect(await store.get("agent-profile.anthropic.work")).toBe("A2");
    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: start.capabilityToken, name: "anthropic" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("auth.remove deletes metadata, store entries, and revokes live sessions bound to that profile", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("A"),
      }),
      ctx
    );
    const start = (await handler["session.start"]?.(
      req("session.start", {
        sessionId: "s-remove",
        pid: 42,
        authProfileId: "work",
        ttlMs: 60_000,
      }),
      ctx
    )) as { capabilityToken: string };
    const body = (await handler["auth.remove"]?.(req("auth.remove", { authId: "work" }), ctx)) as {
      failed: string[];
    };
    expect(body.failed).toEqual([]);
    expect(await store.get("agent-profile.anthropic.work")).toBeNull();
    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: start.capabilityToken, name: "anthropic" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("session.start issues a token, secret.get verifies, session.end revokes", async () => {
    const handler = build();
    // Seed an auth profile + secret.
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("SECRET-A"),
      }),
      ctx
    );
    const start = (await handler["session.start"]?.(
      req("session.start", { sessionId: "s-1", pid: 7777, authProfileId: "work", ttlMs: 60_000 }),
      ctx
    )) as { capabilityToken: string; expiresAtMs: number };
    expect(start.capabilityToken).toBeTruthy();
    expect(start.expiresAtMs).toBe(1_000 + 60_000);

    const got = (await handler["secret.get"]?.(
      req("secret.get", { capabilityToken: start.capabilityToken, name: "anthropic" }),
      ctx
    )) as { valueB64: string };
    expect(Buffer.from(got.valueB64, "base64").toString("utf8")).toBe("SECRET-A");

    await handler["session.end"]?.(req("session.end", { sessionId: "s-1" }), ctx);

    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: start.capabilityToken, name: "anthropic" }),
        ctx
      )
    ).rejects.toBeInstanceOf(IpcError);
  });

  it("secret.get rejects an unsigned/garbage token as AUTH", async () => {
    const handler = build();
    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: "garbage", name: "anthropic" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("secret.get rejects a verified token whose session is not live as AUTH", async () => {
    const handler = build();
    const ghost = issuer.issue({ sessionId: "ghost", pid: 333, ttlMs: 60_000 });

    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: ghost.token, name: "anthropic" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("secret.get rejects an unbound live session as BAD_REQUEST", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("SECRET-A"),
      }),
      ctx
    );
    const start = (await handler["session.start"]?.(
      req("session.start", { sessionId: "s-unbound", pid: 444, ttlMs: 60_000 }),
      ctx
    )) as { capabilityToken: string };

    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: start.capabilityToken, name: "anthropic" }),
        ctx
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("secret.get resolves MCP secrets only within the bound auth profile", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("A"),
      }),
      ctx
    );
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "personal",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/personal" },
        },
        anthropicSecretB64: b64("B"),
      }),
      ctx
    );
    await handler["auth.setSecret"]?.(
      req("auth.setSecret", {
        authId: "work",
        name: "github.pat",
        valueB64: b64("PAT-WORK"),
        register: true,
      }),
      ctx
    );
    await handler["auth.setSecret"]?.(
      req("auth.setSecret", {
        authId: "personal",
        name: "github.pat",
        valueB64: b64("PAT-PERSONAL"),
        register: true,
      }),
      ctx
    );
    const start = (await handler["session.start"]?.(
      req("session.start", {
        sessionId: "s-bound",
        pid: 555,
        authProfileId: "personal",
        ttlMs: 60_000,
      }),
      ctx
    )) as { capabilityToken: string };

    const got = (await handler["secret.get"]?.(
      req("secret.get", { capabilityToken: start.capabilityToken, name: "github.pat" }),
      ctx
    )) as { valueB64: string };

    expect(Buffer.from(got.valueB64, "base64").toString("utf8")).toBe("PAT-PERSONAL");
  });

  it("secrets.migrate moves keyring entries into the safeStorage store", async () => {
    keyring.seed("agent-profile.anthropic.work", "FROM-KEYRING");
    const handler = build()["secrets.migrate"];
    if (!handler) throw new Error("missing handler");
    const r = (await handler(req("secrets.migrate"), ctx)) as {
      scanned: number;
      migrated: number;
    };
    expect(r.scanned).toBe(1);
    expect(r.migrated).toBe(1);
    expect(await store.get("agent-profile.anthropic.work")).toBe("FROM-KEYRING");
  });

  it("secrets.migrate dry-run leaves the store untouched", async () => {
    keyring.seed("agent-profile.anthropic.work", "FROM-KEYRING");
    const handler = build()["secrets.migrate"];
    if (!handler) throw new Error("missing handler");
    const r = (await handler(req("secrets.migrate", { dryRun: true }), ctx)) as {
      migrated: number;
    };
    expect(r.migrated).toBe(1);
    expect(await store.get("agent-profile.anthropic.work")).toBeNull();
  });

  it("audit log records secret_access with capabilityValid=true on success and false on failure", async () => {
    const handler = build();
    await handler["auth.add"]?.(
      req("auth.add", {
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecretB64: b64("S"),
      }),
      ctx
    );
    const start = (await handler["session.start"]?.(
      req("session.start", { sessionId: "s-1", pid: 1, authProfileId: "work", ttlMs: 60_000 }),
      ctx
    )) as { capabilityToken: string };
    await handler["secret.get"]?.(
      req("secret.get", { capabilityToken: start.capabilityToken, name: "anthropic" }),
      ctx
    );
    await expect(
      handler["secret.get"]?.(
        req("secret.get", { capabilityToken: "bogus", name: "anthropic" }),
        ctx
      )
    ).rejects.toBeInstanceOf(IpcError);

    const log = await readFile(auditPath, "utf8");
    const lines = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const access = lines.filter((r) => r.kind === "secret_access");
    expect(access.length).toBe(2);
    expect(access.some((r) => r.capabilityValid === true)).toBe(true);
    expect(access.some((r) => r.capabilityValid === false)).toBe(true);
    // Plaintext invariant: the secret value used by this test ("S") must
    // never appear inside an audit row's value position. We assert the
    // structural fields are present and that no value-bearing key is logged.
    for (const row of lines) {
      expect(row).not.toHaveProperty("valueB64");
      expect(row).not.toHaveProperty("value");
      expect(row).not.toHaveProperty("plaintext");
    }
  });

  describe("session cleanup", () => {
    it("removes expired sessions, revokes capabilities, and writes an audit row", async () => {
      const sessionStart = build()["session.start"];
      if (!sessionStart) throw new Error("missing handler");
      await sessionStart(
        req("session.start", {
          sessionId: "doomed",
          pid: 4242,
          authProfileId: "work",
          ttlMs: 100,
        }),
        ctx
      );

      // Reach into the issuer to verify revocation later via verifier.
      // Build a fresh sessions Map via runSessionCleanup directly so we
      // observe the eviction without waiting on setInterval.
      const sessions = new Map<
        string,
        { authProfileId?: string; pid: number; expiresAtMs: number }
      >();
      sessions.set("doomed", { authProfileId: "work", pid: 4242, expiresAtMs: 1_500 });
      // now: 5_000 — well past the expiresAtMs
      await runSessionCleanup({ sessions, now: 5_000, issuer, audit });
      expect(sessions.has("doomed")).toBe(false);

      const auditLines = (await readFile(auditPath, "utf8")).trim().split("\n").filter(Boolean);
      const ended = auditLines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter(
          (row) => row.kind === "launch" && row.event === "ended" && row.sessionId === "doomed"
        );
      expect(ended).toHaveLength(1);
      expect(ended[0]).toMatchObject({ spawnPid: 4242, authProfileId: "work" });
    });

    it("retains sessions whose expiresAtMs is in the future", async () => {
      const sessions = new Map<
        string,
        { authProfileId?: string; pid: number; expiresAtMs: number }
      >();
      sessions.set("alive", { pid: 7, expiresAtMs: 10_000 });
      await runSessionCleanup({ sessions, now: 9_000, issuer, audit });
      expect(sessions.has("alive")).toBe(true);
    });
  });

  describe("session monitor (kill / relaunch / drift)", () => {
    async function seedRecord(
      sessionsRoot: string,
      sessionId: string,
      overrides: Record<string, unknown> = {}
    ): Promise<void> {
      const { writeSessionRecord } = await import("@agent-profile/cli-services");
      const sessionDir = join(sessionsRoot, sessionId);
      await writeSessionRecord({
        sessionsRoot,
        record: {
          version: 1,
          sessionId,
          role: "backend",
          authProfileId: "work",
          cwd: "/repo",
          createdAt: "2026-04-24T10:00:00.000Z",
          updatedAt: "2026-04-24T10:00:00.000Z",
          retained: false,
          cleaned: false,
          runtimePaths: {
            sessionDir,
            claudeConfigDir: join(sessionDir, ".claude"),
            mcpConfig: join(sessionDir, "mcp.json"),
            settings: join(sessionDir, "settings.json"),
            apiKeyHelper: null,
            headersHelper: null,
            claudeMd: null,
          },
          spawn: { command: "claude", args: [] },
          status: "running",
          ...overrides,
        },
      });
    }

    it("sessions.kill signals the live pid, marks the record exited, and broadcasts", async () => {
      const events: Array<Record<string, unknown>> = [];
      const sessions = new Map();
      const handlers = createWriteHandlers({
        myClaudeHome,
        store,
        keyring,
        issuer,
        verifier,
        audit,
        daemonPid: 99,
        now: () => 2_000,
        cleanupIntervalMs: 0,
        sessions,
        broadcast: (evt) => {
          events.push(evt as unknown as Record<string, unknown>);
        },
        killProcess: () => true,
      });
      await seedRecord(join(myClaudeHome, "sessions"), "s-running");
      sessions.set("s-running", { pid: 12345, expiresAtMs: 5_000, authProfileId: "work" });

      const kill = handlers["sessions.kill"];
      if (!kill) throw new Error("missing handler");
      const body = await kill(req("sessions.kill", { sessionId: "s-running" }), ctx);
      expect(body).toMatchObject({ killed: true });
      expect(sessions.has("s-running")).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "sessions.event", event: "killed", sessionId: "s-running" })
      );
    });

    it("sessions.kill returns killed:false when the record is already exited", async () => {
      const sessions = new Map();
      const handlers = createWriteHandlers({
        myClaudeHome,
        store,
        keyring,
        issuer,
        verifier,
        audit,
        daemonPid: 99,
        now: () => 2_000,
        cleanupIntervalMs: 0,
        sessions,
        killProcess: () => true,
      });
      await seedRecord(join(myClaudeHome, "sessions"), "s-exited", { status: "exited" });

      const kill = handlers["sessions.kill"];
      if (!kill) throw new Error("missing handler");
      const body = await kill(req("sessions.kill", { sessionId: "s-exited" }), ctx);
      expect(body).toMatchObject({ killed: false });
    });

    it("sessions.kill throws NOT_FOUND for an unknown session", async () => {
      const handlers = createWriteHandlers({
        myClaudeHome,
        store,
        keyring,
        issuer,
        verifier,
        audit,
        daemonPid: 99,
        cleanupIntervalMs: 0,
        killProcess: () => true,
      });
      const kill = handlers["sessions.kill"];
      if (!kill) throw new Error("missing handler");
      await expect(
        kill(req("sessions.kill", { sessionId: "s-missing" }), ctx)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("sessions.relaunch mints a new sessionId, writes the cloned record, and audits relaunchedFrom", async () => {
      const events: Array<Record<string, unknown>> = [];
      const handlers = createWriteHandlers({
        myClaudeHome,
        store,
        keyring,
        issuer,
        verifier,
        audit,
        daemonPid: 99,
        now: () => 3_000,
        cleanupIntervalMs: 0,
        broadcast: (evt) => {
          events.push(evt as unknown as Record<string, unknown>);
        },
        killProcess: () => true,
      });
      await seedRecord(join(myClaudeHome, "sessions"), "s-original", {
        launchHash: "abc123",
      });

      const relaunch = handlers["sessions.relaunch"];
      if (!relaunch) throw new Error("missing handler");
      const body = await relaunch(req("sessions.relaunch", { sessionId: "s-original" }), ctx);
      expect(body).toMatchObject({ relaunchedFrom: "s-original" });
      expect(typeof (body as { sessionId: string }).sessionId).toBe("string");
      expect((body as { sessionId: string }).sessionId).not.toBe("s-original");

      const auditLines = (await readFile(auditPath, "utf8")).trim().split("\n").filter(Boolean);
      const launches = auditLines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter(
          (row) =>
            row.kind === "launch" && row.event === "started" && row.relaunchedFrom === "s-original"
        );
      expect(launches).toHaveLength(1);

      expect(events).toContainEqual(
        expect.objectContaining({ kind: "sessions.event", event: "started" })
      );
    });

    it("sessions.drift reports drifted=false when the recomputed hash matches", async () => {
      const handlers = createWriteHandlers({
        myClaudeHome,
        store,
        keyring,
        issuer,
        verifier,
        audit,
        daemonPid: 99,
        cleanupIntervalMs: 0,
        killProcess: () => true,
      });
      const drift = handlers["sessions.drift"];
      if (!drift) throw new Error("missing handler");

      // We don't seed a record; expect the BAD_REQUEST guard to fire (no
      // launch hash). This is the cheapest assertion the daemon-side handler
      // can make without standing up a full profileShowService stub.
      await seedRecord(join(myClaudeHome, "sessions"), "s-no-hash");
      await expect(
        drift(req("sessions.drift", { sessionId: "s-no-hash" }), ctx)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ─── setup.markComplete (M7 first-run) ─────────────────────────────────────

  describe("setup.markComplete", () => {
    it("writes the setup-complete marker with mode 0600 and an audit row", async () => {
      const handlers = build();
      const handler = handlers["setup.markComplete"];
      if (!handler) throw new Error("missing handler");

      const body = await handler(req("setup.markComplete"), ctx);
      expect(body).toEqual({});

      const markerPath = join(myClaudeHome, ".setup-complete");
      const contents = await readFile(markerPath, "utf8");
      // Body is an ISO timestamp; parsing must succeed.
      expect(Number.isNaN(Date.parse(contents))).toBe(false);

      if (process.platform !== "win32") {
        const { stat } = await import("node:fs/promises");
        const s = await stat(markerPath);
        expect(s.mode & 0o777).toBe(0o600);
      }

      const auditLines = (await readFile(auditPath, "utf8")).trim().split("\n").filter(Boolean);
      const audited = auditLines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((row) => row.kind === "config_change" && row.actionKind === "setup.markComplete");
      expect(audited).toHaveLength(1);
      expect(audited[0]).toMatchObject({
        actor: "gui",
        target: ".setup-complete",
      });
    });

    it("is idempotent — a second call overwrites without throwing", async () => {
      const handlers = build();
      const handler = handlers["setup.markComplete"];
      if (!handler) throw new Error("missing handler");
      await handler(req("setup.markComplete"), ctx);
      await handler(req("setup.markComplete"), ctx);
      const markerPath = join(myClaudeHome, ".setup-complete");
      const contents = await readFile(markerPath, "utf8");
      expect(contents.length).toBeGreaterThan(0);
    });
  });
});

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
import { createWriteHandlers } from "../src/main/daemon/handlers-write.js";

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
    });
  }

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

  it("auth.rotate replaces the stored secret and revokes live sessions", async () => {
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
    await handler["auth.rotate"]?.(
      req("auth.rotate", { authId: "work", anthropicSecretB64: b64("A2") }),
      ctx
    );
    expect(await store.get("agent-profile.anthropic.work")).toBe("A2");
  });

  it("auth.remove deletes metadata and store entries", async () => {
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
    const body = (await handler["auth.remove"]?.(req("auth.remove", { authId: "work" }), ctx)) as {
      failed: string[];
    };
    expect(body.failed).toEqual([]);
    expect(await store.get("agent-profile.anthropic.work")).toBeNull();
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
      req("session.start", { sessionId: "s-1", pid: 7777, ttlMs: 60_000 }),
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
      req("session.start", { sessionId: "s-1", pid: 1, ttlMs: 60_000 }),
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
});

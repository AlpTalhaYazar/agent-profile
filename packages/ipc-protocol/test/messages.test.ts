import { describe, expect, it } from "vitest";
import {
  Req,
  ReqAuthAdd,
  ReqAuthGetSecretRef,
  ReqAuthList,
  ReqAuthRemove,
  ReqAuthRotate,
  ReqAuthSetSecret,
  ReqDaemonStatus,
  ReqDaemonStop,
  ReqHello,
  ReqProfileShow,
  ReqSecretGet,
  ReqSecretsMigrate,
  ReqSessionEnd,
  ReqSessionStart,
  ReqSessionsList,
  Resp,
  RespAuthAddOk,
  RespAuthGetSecretRefOk,
  RespAuthListOk,
  RespAuthRemoveOk,
  RespAuthRotateOk,
  RespAuthSetSecretOk,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespError,
  RespHelloOk,
  RespProfileShowOk,
  RespSecretGetOk,
  RespSecretsMigrateOk,
  RespSessionEndOk,
  RespSessionStartOk,
  RespSessionsListOk,
} from "../src/messages.js";

describe("Req schemas", () => {
  describe("ReqHello", () => {
    it("accepts a valid hello", () => {
      const result = ReqHello.safeParse({
        id: "c-1",
        kind: "hello",
        clientVersion: "0.1.0",
        pid: 12345,
        cookie: "abc",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a hello missing the cookie", () => {
      const result = ReqHello.safeParse({
        id: "c-1",
        kind: "hello",
        clientVersion: "0.1.0",
        pid: 12345,
      });
      expect(result.success).toBe(false);
    });

    it("rejects a hello with a non-numeric pid", () => {
      const result = ReqHello.safeParse({
        id: "c-1",
        kind: "hello",
        clientVersion: "0.1.0",
        pid: "abc",
        cookie: "abc",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty id", () => {
      const result = ReqHello.safeParse({
        id: "",
        kind: "hello",
        clientVersion: "0.1.0",
        pid: 1,
        cookie: "x",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ReqAuthList", () => {
    it("accepts with no optional fields", () => {
      const result = ReqAuthList.safeParse({ id: "c-2", kind: "auth.list" });
      expect(result.success).toBe(true);
    });
    it("accepts with includeRefs", () => {
      const result = ReqAuthList.safeParse({
        id: "c-2",
        kind: "auth.list",
        includeRefs: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ReqAuthGetSecretRef", () => {
    it("accepts valid input", () => {
      const result = ReqAuthGetSecretRef.safeParse({
        id: "c-3",
        kind: "auth.get-secret-ref",
        authId: "work",
        name: "github.pat",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing authId", () => {
      const result = ReqAuthGetSecretRef.safeParse({
        id: "c-3",
        kind: "auth.get-secret-ref",
        name: "github.pat",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ReqProfileShow", () => {
    it("accepts valid input", () => {
      const result = ReqProfileShow.safeParse({
        id: "c-4",
        kind: "profile.show",
        role: "backend",
        authProfileId: "work",
        cwd: "/repo",
      });
      expect(result.success).toBe(true);
    });
    it("rejects empty role", () => {
      const result = ReqProfileShow.safeParse({
        id: "c-4",
        kind: "profile.show",
        role: "",
        authProfileId: "work",
        cwd: "/repo",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ReqSessionsList", () => {
    it("accepts with no fields", () => {
      const result = ReqSessionsList.safeParse({ id: "c-5", kind: "sessions.list" });
      expect(result.success).toBe(true);
    });
    it("accepts with activeOnly", () => {
      const result = ReqSessionsList.safeParse({
        id: "c-5",
        kind: "sessions.list",
        activeOnly: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ReqDaemonStatus", () => {
    it("accepts a bare status request", () => {
      const result = ReqDaemonStatus.safeParse({ id: "c-6", kind: "daemon.status" });
      expect(result.success).toBe(true);
    });
  });

  describe("ReqDaemonStop", () => {
    it("accepts with force flag", () => {
      const result = ReqDaemonStop.safeParse({
        id: "c-7",
        kind: "daemon.stop",
        force: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Req discriminated union", () => {
    it("routes by kind", () => {
      const result = Req.safeParse({
        id: "c-8",
        kind: "auth.list",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("auth.list");
      }
    });

    it("rejects an unknown kind", () => {
      const result = Req.safeParse({
        id: "c-8",
        kind: "unknown.kind",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Resp schemas", () => {
  describe("RespHelloOk", () => {
    it("accepts a valid hello.ok", () => {
      const result = RespHelloOk.safeParse({
        id: "c-1",
        kind: "hello.ok",
        serverVersion: "0.1.0",
        accepted: true,
        features: ["auth.list", "sessions.list"],
      });
      expect(result.success).toBe(true);
    });
    it("rejects missing features array", () => {
      const result = RespHelloOk.safeParse({
        id: "c-1",
        kind: "hello.ok",
        serverVersion: "0.1.0",
        accepted: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RespAuthListOk", () => {
    it("accepts profiles with metadata", () => {
      const result = RespAuthListOk.safeParse({
        id: "c-2",
        kind: "auth.list.ok",
        profiles: [{ id: "work", displayName: "Work", mode: "apiKey", secrets: ["anthropic"] }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects a profile missing the secrets array", () => {
      const result = RespAuthListOk.safeParse({
        id: "c-2",
        kind: "auth.list.ok",
        profiles: [{ id: "work", displayName: "Work", mode: "apiKey" }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RespAuthGetSecretRefOk", () => {
    it("accepts a string ref", () => {
      const result = RespAuthGetSecretRefOk.safeParse({
        id: "c-3",
        kind: "auth.get-secret-ref.ok",
        ref: "keyring://github/work",
      });
      expect(result.success).toBe(true);
    });
    it("accepts a null ref", () => {
      const result = RespAuthGetSecretRefOk.safeParse({
        id: "c-3",
        kind: "auth.get-secret-ref.ok",
        ref: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RespProfileShowOk", () => {
    it("accepts unknown effective + provenance", () => {
      const result = RespProfileShowOk.safeParse({
        id: "c-4",
        kind: "profile.show.ok",
        effective: { mcpServers: {} },
        provenance: {},
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RespSessionsListOk", () => {
    it("accepts an array of unknown sessions", () => {
      const result = RespSessionsListOk.safeParse({
        id: "c-5",
        kind: "sessions.list.ok",
        sessions: [{ id: "abc" }, { id: "def" }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RespDaemonStatusOk", () => {
    it("accepts valid status", () => {
      const result = RespDaemonStatusOk.safeParse({
        id: "c-6",
        kind: "daemon.status.ok",
        pid: 1234,
        socketPath: "/tmp/myclaude.sock",
        uptimeMs: 1000,
        sessionCounts: { active: 1, total: 5 },
      });
      expect(result.success).toBe(true);
    });

    it("rejects negative uptime", () => {
      const result = RespDaemonStatusOk.safeParse({
        id: "c-6",
        kind: "daemon.status.ok",
        pid: 1234,
        socketPath: "/tmp/myclaude.sock",
        uptimeMs: -1,
        sessionCounts: { active: 1, total: 5 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RespDaemonStopOk", () => {
    it("accepts a bare stop ok", () => {
      const result = RespDaemonStopOk.safeParse({ id: "c-7", kind: "daemon.stop.ok" });
      expect(result.success).toBe(true);
    });
  });

  describe("RespError", () => {
    it("accepts a valid error response", () => {
      const result = RespError.safeParse({
        id: "c-1",
        kind: "error",
        code: "AUTH",
        reason: "bad cookie",
        requestKind: "hello",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown error code", () => {
      const result = RespError.safeParse({
        id: "c-1",
        kind: "error",
        code: "WHO_KNOWS",
        reason: "x",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Resp discriminated union", () => {
    it("routes by kind", () => {
      const result = Resp.safeParse({
        id: "c-8",
        kind: "error",
        code: "INTERNAL",
        reason: "boom",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe("error");
      }
    });

    it("rejects an unknown kind", () => {
      const result = Resp.safeParse({
        id: "c-8",
        kind: "missing.ok",
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Write-side Req schemas ──────────────────────────────────────────────────

describe("write-side Req schemas", () => {
  const validSpec = {
    id: "work",
    displayName: "Work",
    anthropic: { mode: "apiKey" as const, secretRef: "keyring://anthropic/work" },
  };

  describe("ReqAuthAdd", () => {
    it("accepts a valid auth.add", () => {
      const r = ReqAuthAdd.safeParse({
        id: "c-100",
        kind: "auth.add",
        spec: validSpec,
        anthropicSecretB64: Buffer.from("hello").toString("base64"),
      });
      expect(r.success).toBe(true);
    });

    it("accepts the optional force flag", () => {
      const r = ReqAuthAdd.safeParse({
        id: "c-100",
        kind: "auth.add",
        spec: validSpec,
        anthropicSecretB64: "aGk=",
        force: true,
      });
      expect(r.success).toBe(true);
    });

    it("rejects when anthropicSecretB64 is missing", () => {
      const r = ReqAuthAdd.safeParse({ id: "c-100", kind: "auth.add", spec: validSpec });
      expect(r.success).toBe(false);
    });

    it("rejects when spec.anthropic.mode is unknown", () => {
      const r = ReqAuthAdd.safeParse({
        id: "c-100",
        kind: "auth.add",
        spec: { ...validSpec, anthropic: { mode: "weird", secretRef: "keyring://x/y" } },
        anthropicSecretB64: "aGk=",
      });
      expect(r.success).toBe(false);
    });

    it("rejects unknown spec keys (strict)", () => {
      const r = ReqAuthAdd.safeParse({
        id: "c-100",
        kind: "auth.add",
        spec: { ...validSpec, extra: "no" },
        anthropicSecretB64: "aGk=",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("ReqAuthSetSecret", () => {
    it("accepts valid input", () => {
      const r = ReqAuthSetSecret.safeParse({
        id: "c-101",
        kind: "auth.setSecret",
        authId: "work",
        name: "github.pat",
        valueB64: Buffer.from("pat-value").toString("base64"),
      });
      expect(r.success).toBe(true);
    });

    it("rejects empty valueB64", () => {
      const r = ReqAuthSetSecret.safeParse({
        id: "c-101",
        kind: "auth.setSecret",
        authId: "work",
        name: "github.pat",
        valueB64: "",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("ReqAuthRotate", () => {
    it("accepts valid input", () => {
      const r = ReqAuthRotate.safeParse({
        id: "c-102",
        kind: "auth.rotate",
        authId: "work",
        anthropicSecretB64: "bmV3",
      });
      expect(r.success).toBe(true);
    });

    it("rejects missing authId", () => {
      const r = ReqAuthRotate.safeParse({
        id: "c-102",
        kind: "auth.rotate",
        anthropicSecretB64: "bmV3",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("ReqAuthRemove", () => {
    it("accepts with no flags", () => {
      const r = ReqAuthRemove.safeParse({
        id: "c-103",
        kind: "auth.remove",
        authId: "work",
      });
      expect(r.success).toBe(true);
    });

    it("accepts the advisory yes flag", () => {
      const r = ReqAuthRemove.safeParse({
        id: "c-103",
        kind: "auth.remove",
        authId: "work",
        yes: true,
      });
      expect(r.success).toBe(true);
    });
  });

  describe("ReqSessionStart", () => {
    it("accepts a valid request", () => {
      const r = ReqSessionStart.safeParse({
        id: "c-110",
        kind: "session.start",
        sessionId: "abc",
        pid: 12345,
      });
      expect(r.success).toBe(true);
    });

    it("accepts the optional ttlMs override", () => {
      const r = ReqSessionStart.safeParse({
        id: "c-110",
        kind: "session.start",
        sessionId: "abc",
        pid: 12345,
        ttlMs: 30_000,
      });
      expect(r.success).toBe(true);
    });

    it("rejects negative pid", () => {
      const r = ReqSessionStart.safeParse({
        id: "c-110",
        kind: "session.start",
        sessionId: "abc",
        pid: -1,
      });
      expect(r.success).toBe(false);
    });

    it("rejects ttlMs <= 0", () => {
      const r = ReqSessionStart.safeParse({
        id: "c-110",
        kind: "session.start",
        sessionId: "abc",
        pid: 1,
        ttlMs: 0,
      });
      expect(r.success).toBe(false);
    });
  });

  describe("ReqSessionEnd", () => {
    it("accepts a valid request", () => {
      const r = ReqSessionEnd.safeParse({
        id: "c-111",
        kind: "session.end",
        sessionId: "abc",
      });
      expect(r.success).toBe(true);
    });
  });

  describe("ReqSecretGet", () => {
    it("accepts valid input", () => {
      const r = ReqSecretGet.safeParse({
        id: "c-120",
        kind: "secret.get",
        capabilityToken: "p.m",
        name: "anthropic",
      });
      expect(r.success).toBe(true);
    });

    it("rejects empty capabilityToken", () => {
      const r = ReqSecretGet.safeParse({
        id: "c-120",
        kind: "secret.get",
        capabilityToken: "",
        name: "anthropic",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("ReqSecretsMigrate", () => {
    it("accepts a bare request", () => {
      const r = ReqSecretsMigrate.safeParse({ id: "c-130", kind: "secrets.migrate" });
      expect(r.success).toBe(true);
    });

    it("accepts dryRun and keepKeyring", () => {
      const r = ReqSecretsMigrate.safeParse({
        id: "c-130",
        kind: "secrets.migrate",
        dryRun: true,
        keepKeyring: true,
      });
      expect(r.success).toBe(true);
    });
  });

  describe("Req union routes write-side kinds", () => {
    it("routes auth.add", () => {
      const r = Req.safeParse({
        id: "c-140",
        kind: "auth.add",
        spec: validSpec,
        anthropicSecretB64: "aGk=",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.kind).toBe("auth.add");
    });

    it("routes secret.get", () => {
      const r = Req.safeParse({
        id: "c-141",
        kind: "secret.get",
        capabilityToken: "x.y",
        name: "anthropic",
      });
      expect(r.success).toBe(true);
    });
  });
});

// ─── Write-side Resp schemas ─────────────────────────────────────────────────

describe("write-side Resp schemas", () => {
  it("RespAuthAddOk parses", () => {
    const r = RespAuthAddOk.safeParse({ id: "c-200", kind: "auth.add.ok" });
    expect(r.success).toBe(true);
  });

  it("RespAuthSetSecretOk parses", () => {
    const r = RespAuthSetSecretOk.safeParse({ id: "c-201", kind: "auth.setSecret.ok" });
    expect(r.success).toBe(true);
  });

  it("RespAuthRotateOk parses", () => {
    const r = RespAuthRotateOk.safeParse({ id: "c-202", kind: "auth.rotate.ok" });
    expect(r.success).toBe(true);
  });

  it("RespAuthRemoveOk parses with empty failed array", () => {
    const r = RespAuthRemoveOk.safeParse({
      id: "c-203",
      kind: "auth.remove.ok",
      failed: [],
    });
    expect(r.success).toBe(true);
  });

  it("RespAuthRemoveOk parses with partial failures", () => {
    const r = RespAuthRemoveOk.safeParse({
      id: "c-203",
      kind: "auth.remove.ok",
      failed: ["github.pat"],
    });
    expect(r.success).toBe(true);
  });

  it("RespSessionStartOk parses", () => {
    const r = RespSessionStartOk.safeParse({
      id: "c-210",
      kind: "session.start.ok",
      capabilityToken: "p.m",
      expiresAtMs: 1_700_000_000_000,
    });
    expect(r.success).toBe(true);
  });

  it("RespSessionStartOk rejects empty capabilityToken", () => {
    const r = RespSessionStartOk.safeParse({
      id: "c-210",
      kind: "session.start.ok",
      capabilityToken: "",
      expiresAtMs: 1,
    });
    expect(r.success).toBe(false);
  });

  it("RespSessionEndOk parses", () => {
    const r = RespSessionEndOk.safeParse({ id: "c-211", kind: "session.end.ok" });
    expect(r.success).toBe(true);
  });

  it("RespSecretGetOk parses", () => {
    const r = RespSecretGetOk.safeParse({
      id: "c-220",
      kind: "secret.get.ok",
      valueB64: "c2VjcmV0",
    });
    expect(r.success).toBe(true);
  });

  it("RespSecretGetOk rejects empty valueB64", () => {
    const r = RespSecretGetOk.safeParse({
      id: "c-220",
      kind: "secret.get.ok",
      valueB64: "",
    });
    expect(r.success).toBe(false);
  });

  it("RespSecretsMigrateOk parses", () => {
    const r = RespSecretsMigrateOk.safeParse({
      id: "c-230",
      kind: "secrets.migrate.ok",
      scanned: 3,
      migrated: 2,
      skipped: 1,
      errors: [],
    });
    expect(r.success).toBe(true);
  });

  it("RespSecretsMigrateOk parses with errors", () => {
    const r = RespSecretsMigrateOk.safeParse({
      id: "c-230",
      kind: "secrets.migrate.ok",
      scanned: 2,
      migrated: 1,
      skipped: 0,
      errors: [{ key: "agent-profile.x.y", reason: "decrypt failed" }],
    });
    expect(r.success).toBe(true);
  });

  it("Resp union routes write-side responses", () => {
    const r = Resp.safeParse({
      id: "c-240",
      kind: "secret.get.ok",
      valueB64: "AA==",
    });
    expect(r.success).toBe(true);
  });
});

// ─── No-plaintext-on-the-wire invariant ──────────────────────────────────────

describe("wire never contains plaintext secrets", () => {
  const SECRET = "PLAINTEXT-VALUE-XYZ";
  const SECRET_B64 = Buffer.from(SECRET, "utf8").toString("base64");

  it("auth.add JSON does not echo plaintext", () => {
    const msg = {
      id: "c-300",
      kind: "auth.add",
      spec: {
        id: "work",
        displayName: "Work",
        anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
      },
      anthropicSecretB64: SECRET_B64,
    };
    const json = JSON.stringify(msg);
    expect(json).toContain(SECRET_B64);
    expect(json).not.toContain(SECRET);
    expect(ReqAuthAdd.safeParse(msg).success).toBe(true);
  });

  it("auth.setSecret JSON does not echo plaintext", () => {
    const msg = {
      id: "c-301",
      kind: "auth.setSecret",
      authId: "work",
      name: "github.pat",
      valueB64: SECRET_B64,
    };
    const json = JSON.stringify(msg);
    expect(json).toContain(SECRET_B64);
    expect(json).not.toContain(SECRET);
    expect(ReqAuthSetSecret.safeParse(msg).success).toBe(true);
  });

  it("secret.get.ok JSON does not echo plaintext", () => {
    const msg = {
      id: "c-302",
      kind: "secret.get.ok",
      valueB64: SECRET_B64,
    };
    const json = JSON.stringify(msg);
    expect(json).toContain(SECRET_B64);
    expect(json).not.toContain(SECRET);
    expect(RespSecretGetOk.safeParse(msg).success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  Req,
  ReqAuthGetSecretRef,
  ReqAuthList,
  ReqDaemonStatus,
  ReqDaemonStop,
  ReqHello,
  ReqProfileShow,
  ReqSessionsList,
  Resp,
  RespAuthGetSecretRefOk,
  RespAuthListOk,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespError,
  RespHelloOk,
  RespProfileShowOk,
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

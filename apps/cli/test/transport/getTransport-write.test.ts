/**
 * Round-trip tests for the write-side transport methods (auth.add /
 * auth.setSecret / auth.rotate / auth.remove / secrets.migrate).
 *
 * Spins up a real `DaemonServer` over a UDS with stub handlers and asserts
 * the CLI's `DaemonTransport` encodes + decodes the wire shapes correctly.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonServer, type Handler, type HandlerMap } from "@agent-profile/ipc-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTransport } from "../../src/transport/index.js";

const skipOnWindows = process.platform === "win32";

let counter = 0;
function shortSocketPath(workdir: string): string {
  counter += 1;
  return join(workdir, `s${process.pid}_${counter}.sock`);
}

describe.skipIf(skipOnWindows)("write-side transport round-trips", () => {
  let workdir: string;
  let myClaudeDir: string;
  let socketPath: string;
  let server: DaemonServer | null = null;
  let originalSocketEnv: string | undefined;
  let originalForceStandalone: string | undefined;

  beforeEach(async () => {
    workdir = await mkdtemp("/tmp/ap-write-");
    myClaudeDir = join(workdir, ".myclaude");
    socketPath = shortSocketPath(workdir);
    await mkdir(myClaudeDir, { recursive: true, mode: 0o700 });
    const cookie = "test-cookie-write";
    const cookiePath = join(myClaudeDir, "ipc-cookie");
    await writeFile(cookiePath, cookie, { mode: 0o600, encoding: "utf8" });
    await chmod(cookiePath, 0o600);

    originalSocketEnv = process.env.MYCLAUDE_SOCKET;
    originalForceStandalone = process.env.MYCLAUDE_FORCE_STANDALONE;
    process.env.MYCLAUDE_SOCKET = socketPath;
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  afterEach(async () => {
    if (server) {
      await server.drainAndClose({ drainMs: 500 });
      server = null;
    }
    await rm(workdir, { recursive: true, force: true });
    if (originalSocketEnv === undefined) {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.MYCLAUDE_SOCKET;
    } else {
      process.env.MYCLAUDE_SOCKET = originalSocketEnv;
    }
    if (originalForceStandalone === undefined) {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.MYCLAUDE_FORCE_STANDALONE;
    } else {
      process.env.MYCLAUDE_FORCE_STANDALONE = originalForceStandalone;
    }
  });

  async function startServer(handlers: HandlerMap): Promise<void> {
    server = new DaemonServer({
      socketPath,
      cookie: "test-cookie-write",
      serverVersion: "0.0.1",
      features: ["auth.add", "auth.setSecret", "auth.rotate", "auth.remove", "secrets.migrate"],
      handlers,
    });
    await server.start();
  }

  it("authAdd encodes the secret as base64 and the daemon decodes it", async () => {
    type AuthAddCapture = { anthropicSecretB64: string; specId: string };
    const captured: AuthAddCapture[] = [];
    const handler: Handler = async (req) => {
      const r = req as unknown as { spec: { id: string }; anthropicSecretB64: string };
      captured.push({ anthropicSecretB64: r.anthropicSecretB64, specId: r.spec.id });
      return {};
    };
    await startServer({ "auth.add": handler });

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      await transport.authAdd({
        spec: {
          id: "work",
          anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
        },
        anthropicSecret: "PLAINTEXT-ABC",
      });
    } finally {
      await transport.close();
    }
    expect(captured).toHaveLength(1);
    const c = captured[0] as AuthAddCapture;
    const decoded = Buffer.from(c.anthropicSecretB64, "base64").toString("utf8");
    expect(decoded).toBe("PLAINTEXT-ABC");
    // The plaintext does NOT appear as a literal substring on the wire
    // ("PLAINTEXT-ABC" is not the same as its base64). Sanity check.
    expect(c.anthropicSecretB64).not.toBe("PLAINTEXT-ABC");
  });

  it("authSetSecret round-trips name + register flag", async () => {
    type SetCapture = { authId: string; name: string; valueB64: string; register: boolean };
    const captured: SetCapture[] = [];
    const handler: Handler = async (req) => {
      captured.push(req as unknown as SetCapture);
      return {};
    };
    await startServer({ "auth.setSecret": handler });

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      await transport.authSetSecret({
        authId: "work",
        name: "github.pat",
        value: "PAT-ABC",
        register: true,
      });
    } finally {
      await transport.close();
    }
    expect(captured).toHaveLength(1);
    const c = captured[0] as SetCapture;
    expect(c.authId).toBe("work");
    expect(c.name).toBe("github.pat");
    expect(c.register).toBe(true);
    expect(Buffer.from(c.valueB64, "base64").toString("utf8")).toBe("PAT-ABC");
  });

  it("authRotate base64-encodes the new secret", async () => {
    type RotateCapture = { authId: string; anthropicSecretB64: string };
    const captured: RotateCapture[] = [];
    const handler: Handler = async (req) => {
      captured.push(req as unknown as RotateCapture);
      return {};
    };
    await startServer({ "auth.rotate": handler });

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      await transport.authRotate({ authId: "work", anthropicSecret: "ROTATED" });
    } finally {
      await transport.close();
    }
    expect(captured).toHaveLength(1);
    const c = captured[0] as RotateCapture;
    expect(c.authId).toBe("work");
    expect(Buffer.from(c.anthropicSecretB64, "base64").toString("utf8")).toBe("ROTATED");
  });

  it("authRemove returns the failed list", async () => {
    const handler: Handler = async () => ({ failed: ["github.pat"] });
    await startServer({ "auth.remove": handler });

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      const result = await transport.authRemove({ authId: "work" });
      expect(result.failed).toEqual(["github.pat"]);
    } finally {
      await transport.close();
    }
  });

  it("secretsMigrate returns the report shape", async () => {
    const handler: Handler = async (req) => {
      const r = req as unknown as { dryRun?: boolean; keepKeyring?: boolean };
      return {
        scanned: 5,
        migrated: r.dryRun ? 0 : 4,
        skipped: 1,
        errors:
          r.keepKeyring === false ? [{ key: "agent-profile.x.y", reason: "cleanup failed" }] : [],
      };
    };
    await startServer({ "secrets.migrate": handler });

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      const r1 = await transport.secretsMigrate({});
      expect(r1.scanned).toBe(5);
      expect(r1.migrated).toBe(4);
      expect(r1.skipped).toBe(1);
      expect(r1.errors).toEqual([]);

      const r2 = await transport.secretsMigrate({ dryRun: true });
      expect(r2.migrated).toBe(0);
    } finally {
      await transport.close();
    }
  });

  it("sessionStart/sessionEnd round-trip and stay compatible with older daemons", async () => {
    type StartCapture = { sessionId: string; pid: number };
    type EndCapture = { sessionId: string };
    const starts: StartCapture[] = [];
    const ends: EndCapture[] = [];

    await startServer({
      "session.start": async (req) => {
        starts.push(req as unknown as StartCapture);
        return {
          capabilityToken: "daemon-issued-token",
          expiresAtMs: 123_456,
        };
      },
      "session.end": async (req) => {
        ends.push(req as unknown as EndCapture);
        return {};
      },
    });

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      const started = await transport.sessionStart({
        sessionId: "session-123",
        pid: 4242,
        authProfileId: "work",
      });
      expect(started).toEqual({
        capabilityToken: "daemon-issued-token",
        expiresAtMs: 123_456,
      });

      await transport.sessionEnd({ sessionId: "session-123" });
    } finally {
      await transport.close();
    }

    expect(starts).toHaveLength(1);
    expect(starts[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-123",
        pid: 4242,
      })
    );
    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-123",
      })
    );
  });
});

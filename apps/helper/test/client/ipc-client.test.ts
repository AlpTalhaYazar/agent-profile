/**
 * Tests for {@link createIpcHelperClient}.
 *
 * Spins up a real `DaemonServer` over a UDS, plants a cookie file, and
 * verifies the helper client round-trips a `secret.get` call (capability
 * token verified by the daemon, base64 decoded by the client).
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonServer, type Handler, type HandlerMap } from "@agent-profile/ipc-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIpcHelperClient } from "../../src/client/ipc-client.js";
import { HelperError } from "../../src/errors.js";

const skipOnWindows = process.platform === "win32";

let counter = 0;
function shortSocketPath(workdir: string): string {
  counter += 1;
  return join(workdir, `s${process.pid}_${counter}.sock`);
}

describe.skipIf(skipOnWindows)("createIpcHelperClient", () => {
  let workdir: string;
  let myClaudeDir: string;
  let socketPath: string;
  let server: DaemonServer | null = null;
  let originalSocketEnv: string | undefined;

  beforeEach(async () => {
    workdir = await mkdtemp("/tmp/ap-helper-ipc-");
    myClaudeDir = join(workdir, ".myclaude");
    socketPath = shortSocketPath(workdir);
    await mkdir(myClaudeDir, { recursive: true, mode: 0o700 });
    const cookiePath = join(myClaudeDir, "ipc-cookie");
    await writeFile(cookiePath, "test-cookie-helper", { mode: 0o600, encoding: "utf8" });
    await chmod(cookiePath, 0o600);

    originalSocketEnv = process.env.MYCLAUDE_SOCKET;
    process.env.MYCLAUDE_SOCKET = socketPath;
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
  });

  async function startServer(handlers: HandlerMap): Promise<void> {
    server = new DaemonServer({
      socketPath,
      cookie: "test-cookie-helper",
      serverVersion: "0.0.1",
      features: ["secret.get"],
      handlers,
    });
    await server.start();
  }

  it("returns the daemon-decoded secret over IPC", async () => {
    let capturedToken = "";
    const handler: Handler = async (req) => {
      const r = req as unknown as { capabilityToken: string; name: string };
      capturedToken = r.capabilityToken;
      expect(r.name).toBe("anthropic");
      return { valueB64: Buffer.from("DAEMON-SECRET", "utf8").toString("base64") };
    };
    await startServer({ "secret.get": handler });

    const client = await createIpcHelperClient({ myClaudeHome: myClaudeDir });
    const value = await client.anthropic({
      sessionId: "s-1",
      capabilityToken: "TOKEN-XYZ",
    });
    expect(value).toBe("DAEMON-SECRET");
    expect(capturedToken).toBe("TOKEN-XYZ");
  });

  it("translates an AUTH error to EXIT_CAPABILITY_DENIED", async () => {
    const handler: Handler = async () => {
      const { IpcError } = await import("@agent-profile/ipc-protocol");
      throw new IpcError("AUTH", "capability token invalid: bad-signature");
    };
    await startServer({ "secret.get": handler });

    const client = await createIpcHelperClient({ myClaudeHome: myClaudeDir });
    let captured: unknown = null;
    try {
      await client.anthropic({ sessionId: "s-1", capabilityToken: "bad" });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(HelperError);
    // EXIT_CAPABILITY_DENIED = 6
    expect((captured as HelperError).exitCode).toBe(6);
  });

  it("rejects when the daemon is unreachable (cookie missing)", async () => {
    // Remove the cookie file; createIpcHelperClient must surface the failure
    // so the entry-point can fall back to in-process.
    await rm(join(myClaudeDir, "ipc-cookie"), { force: true });
    await expect(
      createIpcHelperClient({ myClaudeHome: myClaudeDir, attemptTimeoutMs: 250 })
    ).rejects.toBeDefined();
  });

  it("times out a stale-socket connect attempt", async () => {
    // No server started: socket path won't exist, connectToSocket will
    // produce ENOENT/refused immediately or time out.
    await expect(
      createIpcHelperClient({ myClaudeHome: myClaudeDir, attemptTimeoutMs: 100 })
    ).rejects.toBeDefined();
  });
});

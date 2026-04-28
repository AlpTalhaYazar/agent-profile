import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToSocket } from "../src/client.js";
import { IpcError } from "../src/errors.js";
import { DaemonServer, type Handler } from "../src/server.js";

const skipOnWindows = process.platform === "win32";

// macOS limits UDS paths to ~104 bytes, so we keep the prefix and the random
// suffix as short as we can while still being unique across parallel tests.
let counter = 0;
function shortSocketPath(workdir: string): string {
  counter += 1;
  return join(workdir, `s${process.pid}_${counter}.sock`);
}

describe.skipIf(skipOnWindows)("DaemonClient + DaemonServer over UDS", () => {
  let workdir: string;
  let socketPath: string;
  let server: DaemonServer | null = null;

  beforeEach(async () => {
    // Use /tmp instead of $TMPDIR to keep paths short on macOS, where the
    // default $TMPDIR (`/var/folders/...`) easily exceeds the 104-byte UDS
    // path limit.
    workdir = await mkdtemp("/tmp/ipc-");
    socketPath = shortSocketPath(workdir);
  });

  afterEach(async () => {
    if (server) {
      await server.drainAndClose({ drainMs: 500 });
      server = null;
    }
    await rm(workdir, { recursive: true, force: true });
  });

  it("performs handshake and dispatches a request", async () => {
    const cookie = "boot-cookie-value";

    const authListHandler: Handler = async () => ({
      profiles: [
        { id: "work", displayName: "Work", mode: "apiKey", secrets: ["anthropic"] },
        { id: "personal", displayName: "Personal", mode: "apiKey", secrets: [] },
      ],
    });

    server = new DaemonServer({
      socketPath,
      cookie,
      serverVersion: "0.1.0",
      features: ["auth.list"],
      handlers: {
        "auth.list": authListHandler,
      },
    });
    await server.start();

    const client = await connectToSocket({
      socketPath,
      clientVersion: "0.1.0",
      cookie,
    });

    try {
      const resp = await client.request<{
        id: string;
        kind: "auth.list.ok";
        profiles: Array<{ id: string; displayName: string; mode: string; secrets: string[] }>;
      }>("auth.list", {});
      expect(resp.kind).toBe("auth.list.ok");
      expect(resp.profiles).toHaveLength(2);
      expect(resp.profiles[0]?.id).toBe("work");
    } finally {
      client.close();
    }
  });

  it("rejects a connection presenting a bad cookie", async () => {
    server = new DaemonServer({
      socketPath,
      cookie: "expected-cookie",
      serverVersion: "0.1.0",
      handlers: {},
    });
    await server.start();

    await expect(
      connectToSocket({
        socketPath,
        clientVersion: "0.1.0",
        cookie: "wrong-cookie",
      })
    ).rejects.toBeInstanceOf(IpcError);
  });

  it("rejects a connection with an incompatible major version", async () => {
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "1.0.0",
      handlers: {},
    });
    await server.start();

    await expect(
      connectToSocket({ socketPath, clientVersion: "2.0.0", cookie: "ck" })
    ).rejects.toMatchObject({ code: "AUTH_VERSION" });
  });

  it("returns NOT_FOUND for a kind without a handler", async () => {
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "0.1.0",
      handlers: {},
    });
    await server.start();
    const client = await connectToSocket({
      socketPath,
      clientVersion: "0.1.0",
      cookie: "ck",
    });
    try {
      await expect(client.request("daemon.status", {})).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      client.close();
    }
  });

  it("propagates handler errors as INTERNAL", async () => {
    const handler: Handler = async () => {
      throw new Error("handler boom");
    };
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "0.1.0",
      handlers: { "daemon.status": handler },
    });
    await server.start();

    const client = await connectToSocket({
      socketPath,
      clientVersion: "0.1.0",
      cookie: "ck",
    });
    try {
      await expect(client.request("daemon.status", {})).rejects.toMatchObject({
        code: "INTERNAL",
      });
    } finally {
      client.close();
    }
  });
});

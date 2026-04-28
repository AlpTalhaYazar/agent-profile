import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToSocket } from "../src/client.js";
import { IpcError } from "../src/errors.js";
import type { EvtSessionsEventT } from "../src/messages.js";
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

  // ─── Push event channel (Phase 2 milestone 5) ─────────────────────────────

  it("delivers a broadcast to a subscribed client", async () => {
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
      const events: EvtSessionsEventT[] = [];
      client.on("sessions.event", (e) => events.push(e));
      await client.subscribe("sessions");
      expect(server.subscriberCount("sessions")).toBe(1);

      const delivered = server.broadcast({
        kind: "sessions.event",
        sessionId: "s-1",
        event: "started",
        ts: 1,
      });
      expect(delivered).toBe(1);

      // Allow the codec data event to flush.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe("started");
      expect(events[0]?.sessionId).toBe("s-1");
    } finally {
      client.close();
    }
  });

  it("does not deliver to a non-subscribed client", async () => {
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
      const events: EvtSessionsEventT[] = [];
      client.on("sessions.event", (e) => events.push(e));
      // No subscribe call — broadcast should reach zero recipients.
      const delivered = server.broadcast({
        kind: "sessions.event",
        sessionId: "s-1",
        event: "started",
        ts: 1,
      });
      expect(delivered).toBe(0);
      await new Promise((r) => setImmediate(r));
      expect(events).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  it("delivers to multiple subscribed clients", async () => {
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "0.1.0",
      handlers: {},
    });
    await server.start();

    const a = await connectToSocket({
      socketPath,
      clientVersion: "0.1.0",
      cookie: "ck",
    });
    const b = await connectToSocket({
      socketPath,
      clientVersion: "0.1.0",
      cookie: "ck",
    });
    try {
      const aEvents: EvtSessionsEventT[] = [];
      const bEvents: EvtSessionsEventT[] = [];
      a.on("sessions.event", (e) => aEvents.push(e));
      b.on("sessions.event", (e) => bEvents.push(e));
      await Promise.all([a.subscribe("sessions"), b.subscribe("sessions")]);
      expect(server.subscriberCount("sessions")).toBe(2);

      const delivered = server.broadcast({
        kind: "sessions.event",
        sessionId: "s-1",
        event: "killed",
        ts: 99,
      });
      expect(delivered).toBe(2);

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(aEvents).toHaveLength(1);
      expect(bEvents).toHaveLength(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it("removes a subscriber when the client disconnects", async () => {
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
    await client.subscribe("sessions");
    expect(server.subscriberCount("sessions")).toBe(1);
    client.close();
    // Allow the server-side `close` listener to run.
    await new Promise((r) => setTimeout(r, 30));
    expect(server.subscriberCount("sessions")).toBe(0);

    // Broadcast after disconnect: should not throw, should deliver to zero.
    const delivered = server.broadcast({
      kind: "sessions.event",
      sessionId: "s-1",
      event: "exited",
      ts: 1,
    });
    expect(delivered).toBe(0);
  });

  it("drains and closes while a subscriber sits idle", async () => {
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
    await client.subscribe("sessions");

    const start = Date.now();
    await server.drainAndClose({ drainMs: 500 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);

    client.close();
    server = null;
  });
});

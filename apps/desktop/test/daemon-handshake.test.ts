/**
 * @file daemon-handshake.test.ts
 *
 * End-to-end test for the daemon's IPC layer: a real `DaemonServer` listening
 * on a tmpdir UDS, with the desktop's `createHandlers` wiring, accepts a
 * `DaemonClient` connection and serves an `auth.list` request from a fixture.
 *
 * Skipped on Windows because the test depends on UDS paths under `/tmp`.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonServer, type RespAuthListOkT, connectToSocket } from "@agent-profile/ipc-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LifecycleHandle, createHandlers } from "../src/main/daemon/handlers.js";

const skipOnWindows = process.platform === "win32";

let counter = 0;
function shortSocketPath(workdir: string): string {
  counter += 1;
  return join(workdir, `s${process.pid}_${counter}.sock`);
}

describe.skipIf(skipOnWindows)("desktop daemon handshake + auth.list", () => {
  let workdir: string;
  let home: string;
  let socketPath: string;
  let server: DaemonServer | null = null;

  beforeEach(async () => {
    workdir = await mkdtemp("/tmp/desk-");
    home = join(workdir, "home");
    await mkdir(join(home, ".myclaude", "config"), { recursive: true });
    socketPath = shortSocketPath(workdir);
  });

  afterEach(async () => {
    if (server) {
      await server.drainAndClose({ drainMs: 500 });
      server = null;
    }
    await rm(workdir, { recursive: true, force: true });
  });

  it("performs handshake and returns auth.list profiles from a fixture home", async () => {
    const yaml = `
version: 1
authProfiles:
  work:
    displayName: "Work (Acme)"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs:
      github.pat: keyring://github/work
  personal:
    displayName: "Personal"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/personal
    mcpSecretRefs: {}
`.trim();
    await writeFile(join(home, ".myclaude", "config", "authProfiles.yml"), yaml);

    const lifecycle: LifecycleHandle = {
      pid: 12345,
      socketPath,
      startedAtMs: Date.now() - 100,
      sessionsRoot: join(home, ".myclaude", "sessions"),
      requestShutdown: () => {
        /* noop */
      },
    };
    const handlers = createHandlers(lifecycle, home);

    server = new DaemonServer({
      socketPath,
      cookie: "boot-cookie-value",
      serverVersion: "0.1.0",
      handlers,
    });
    await server.start();

    const client = await connectToSocket({
      socketPath,
      clientVersion: "0.1.0",
      cookie: "boot-cookie-value",
    });
    try {
      const resp = await client.request<RespAuthListOkT>("auth.list", {});
      expect(resp.kind).toBe("auth.list.ok");
      expect(resp.profiles).toHaveLength(2);
      const work = resp.profiles.find((p) => p.id === "work");
      expect(work).toMatchObject({
        id: "work",
        mode: "apiKey",
        secrets: ["github.pat"],
      });
    } finally {
      client.close();
    }
  });

  it("rejects the connection when the client presents the wrong cookie", async () => {
    const lifecycle: LifecycleHandle = {
      pid: 1,
      socketPath,
      startedAtMs: Date.now(),
      sessionsRoot: join(home, ".myclaude", "sessions"),
      requestShutdown: () => {
        /* noop */
      },
    };
    server = new DaemonServer({
      socketPath,
      cookie: "expected",
      serverVersion: "0.1.0",
      handlers: createHandlers(lifecycle, home),
    });
    await server.start();

    await expect(
      connectToSocket({ socketPath, clientVersion: "0.1.0", cookie: "wrong" })
    ).rejects.toMatchObject({ code: "BAD_COOKIE" });
  });

  it("wires desktop peer verification into lifecycle-owned daemon servers", async () => {
    const verifyPeer = vi.fn(() => ({ ok: false as const, reason: "blocked peer" }));
    vi.resetModules();
    vi.doMock("../src/main/daemon/peer-auth.js", () => ({ verifyPeer }));
    const { DaemonLifecycle } = await import("../src/main/daemon/lifecycle.js");
    const lifecycle = new DaemonLifecycle();

    try {
      await lifecycle.start({
        socketPath,
        cookie: "ck",
        serverVersion: "0.1.0",
        home,
        pid: 123,
        nowMs: 1,
        requestShutdown: () => {
          /* noop */
        },
      });

      await expect(
        connectToSocket({ socketPath, clientVersion: "0.1.0", cookie: "ck" })
      ).rejects.toMatchObject({ code: "DISCONNECTED" });
      expect(verifyPeer).toHaveBeenCalledTimes(1);
    } finally {
      await lifecycle.drainAndClose(500);
      vi.doUnmock("../src/main/daemon/peer-auth.js");
      vi.resetModules();
    }
  });
});

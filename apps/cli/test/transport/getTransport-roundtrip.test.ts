/**
 * End-to-end round-trip: spin up a real `DaemonServer` over a UDS, write a
 * boot cookie file, and verify that `getTransport` connects through and that
 * the resulting transport actually goes over the wire (not the in-process
 * services).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { chmod, mkdtemp } from "node:fs/promises";
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

describe.skipIf(skipOnWindows)("getTransport roundtrip via DaemonServer", () => {
  let workdir: string;
  let myClaudeDir: string;
  let socketPath: string;
  let server: DaemonServer | null = null;
  let originalSocketEnv: string | undefined;
  let originalForceStandalone: string | undefined;

  beforeEach(async () => {
    // Use /tmp for short UDS paths on macOS (104-byte limit).
    workdir = await mkdtemp("/tmp/ap-rt-");
    myClaudeDir = join(workdir, ".myclaude");
    socketPath = shortSocketPath(workdir);

    await mkdir(myClaudeDir, { recursive: true, mode: 0o700 });
    const cookie = "test-cookie-roundtrip";
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

  it("connects, dispatches auth.list through the daemon, and reports kind=daemon", async () => {
    const authListHandler: Handler = async () => ({
      profiles: [
        { id: "work", displayName: "Work (stub)", mode: "apiKey", secrets: ["github.pat"] },
        { id: "personal", displayName: "Personal", mode: "apiKey", secrets: [] },
      ],
    });

    const handlers: HandlerMap = { "auth.list": authListHandler };
    server = new DaemonServer({
      socketPath,
      cookie: "test-cookie-roundtrip",
      serverVersion: "0.0.1",
      features: ["auth.list"],
      handlers,
    });
    await server.start();

    const transport = await getTransport({ home: myClaudeDir, attemptTimeoutMs: 2000 });
    try {
      expect(transport.transportKind).toBe("daemon");
      const result = await transport.authList({ includeRefs: false });
      expect(result.profiles).toHaveLength(2);
      expect(result.profiles[0]?.id).toBe("work");
      expect(result.profiles[0]?.displayName).toBe("Work (stub)");
      expect(result.profiles[1]?.id).toBe("personal");
    } finally {
      await transport.close();
    }
  });
});

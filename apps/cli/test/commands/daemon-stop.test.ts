/**
 * Tests for `myclaude daemon stop`.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonServer, type Handler } from "@agent-profile/ipc-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemonStop } from "../../src/commands/daemon/stop.js";
import { CliError, EXIT_DAEMON_UNREACHABLE } from "../../src/errors.js";

const skipOnWindows = process.platform === "win32";

let counter = 0;
function shortSocketPath(workdir: string): string {
  counter += 1;
  return join(workdir, `dst${process.pid}_${counter}.sock`);
}

describe.skipIf(skipOnWindows)("runDaemonStop", () => {
  let workdir: string;
  let homedir: string;
  let socketPath: string;
  let server: DaemonServer | null = null;
  let originalSocketEnv: string | undefined;

  beforeEach(async () => {
    workdir = await mkdtemp("/tmp/ap-dst-");
    homedir = join(workdir, "home");
    socketPath = shortSocketPath(workdir);
    await mkdir(join(homedir, ".myclaude"), { recursive: true, mode: 0o700 });
    const cookiePath = join(homedir, ".myclaude", "ipc-cookie");
    await writeFile(cookiePath, "ck", { mode: 0o600, encoding: "utf8" });
    await chmod(cookiePath, 0o600);

    originalSocketEnv = process.env.MYCLAUDE_SOCKET;
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
    vi.restoreAllMocks();
  });

  it("throws CliError(EXIT_DAEMON_UNREACHABLE) when no daemon is running", async () => {
    let caught: unknown;
    try {
      await runDaemonStop({ home: homedir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_DAEMON_UNREACHABLE);
  });

  it("sends daemon.stop and prints success when daemon accepts", async () => {
    let receivedForce: boolean | undefined;
    const stopHandler: Handler = async (req) => {
      receivedForce = (req as { force?: boolean }).force;
      return {};
    };
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "0.0.1",
      handlers: { "daemon.stop": stopHandler },
    });
    await server.start();

    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await runDaemonStop({ home: homedir, force: true });

    expect(receivedForce).toBe(true);
    expect(stdout).toContain("Daemon: stopped");
  });
});

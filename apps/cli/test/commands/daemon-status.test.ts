/**
 * Tests for `myclaude daemon status`.
 *
 * Two paths:
 *   - No daemon → throws CliError(EXIT_DAEMON_UNREACHABLE).
 *   - Daemon up → prints the human/JSON status.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonServer, type Handler } from "@agent-profile/ipc-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemonStatus } from "../../src/commands/daemon/status.js";
import { CliError, EXIT_DAEMON_UNREACHABLE } from "../../src/errors.js";

const skipOnWindows = process.platform === "win32";

let counter = 0;
function shortSocketPath(workdir: string): string {
  counter += 1;
  return join(workdir, `ds${process.pid}_${counter}.sock`);
}

describe.skipIf(skipOnWindows)("runDaemonStatus", () => {
  let workdir: string;
  let homedir: string;
  let socketPath: string;
  let server: DaemonServer | null = null;
  let originalSocketEnv: string | undefined;

  beforeEach(async () => {
    workdir = await mkdtemp("/tmp/ap-ds-");
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

  it("throws CliError(EXIT_DAEMON_UNREACHABLE) when daemon is not running", async () => {
    let caught: unknown;
    try {
      await runDaemonStatus({ home: homedir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_DAEMON_UNREACHABLE);
  });

  it("prints human-readable status when daemon is up", async () => {
    const statusHandler: Handler = async () => ({
      pid: 12345,
      socketPath,
      uptimeMs: 3 * 60 * 60 * 1000 + 21 * 60 * 1000,
      sessionCounts: { active: 2, total: 14 },
    });
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "0.0.1",
      handlers: { "daemon.status": statusHandler },
    });
    await server.start();

    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await runDaemonStatus({ home: homedir });

    expect(stdout).toContain("Daemon:    running (pid 12345)");
    expect(stdout).toContain(`Socket:    ${socketPath}`);
    expect(stdout).toContain("3h 21m");
    expect(stdout).toContain("Sessions:  2 active, 14 recent");
  });

  it("emits JSON shape with --json", async () => {
    const statusHandler: Handler = async () => ({
      pid: 1,
      socketPath,
      uptimeMs: 1000,
      sessionCounts: { active: 0, total: 0 },
    });
    server = new DaemonServer({
      socketPath,
      cookie: "ck",
      serverVersion: "0.0.1",
      handlers: { "daemon.status": statusHandler },
    });
    await server.start();

    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await runDaemonStatus({ home: homedir, json: true });

    const parsed = JSON.parse(stdout);
    expect(parsed.pid).toBe(1);
    expect(parsed.socketPath).toBe(socketPath);
    expect(parsed.uptimeMs).toBe(1000);
    expect(parsed.sessionCounts).toEqual({ active: 0, total: 0 });
  });
});

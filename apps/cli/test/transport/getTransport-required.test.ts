/**
 * Verify that `getTransport({ requireDaemon: true })` throws a CliError with
 * exit code 4 when the daemon is unreachable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, EXIT_DAEMON_UNREACHABLE } from "../../src/errors.js";
import { getTransport } from "../../src/transport/index.js";

describe("getTransport requireDaemon", () => {
  let tmpHome: string;
  let originalSocket: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "ap-transport-required-"));
    originalSocket = process.env.MYCLAUDE_SOCKET;
    process.env.MYCLAUDE_SOCKET = join(tmpHome, "no-such.sock");
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    if (originalSocket === undefined) {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.MYCLAUDE_SOCKET;
    } else {
      process.env.MYCLAUDE_SOCKET = originalSocket;
    }
  });

  it("throws CliError(EXIT_DAEMON_UNREACHABLE) when daemon unreachable", async () => {
    let caught: unknown;
    try {
      await getTransport({ home: tmpHome, requireDaemon: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_DAEMON_UNREACHABLE);
  });

  it("rejects when --standalone is combined with --require-daemon", async () => {
    let caught: unknown;
    try {
      await getTransport({ home: tmpHome, requireDaemon: true, standalone: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_DAEMON_UNREACHABLE);
  });
});

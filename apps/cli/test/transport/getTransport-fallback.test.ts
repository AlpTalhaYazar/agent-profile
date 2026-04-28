/**
 * Verify that `getTransport` falls back to the in-process path when no daemon
 * is reachable. The fallback is the Phase 1 behavior — read-only commands
 * MUST keep working when the daemon is absent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcTransport, getTransport } from "../../src/transport/index.js";

describe("getTransport fallback", () => {
  let tmpHome: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "ap-transport-fallback-"));
    originalEnv = {
      MYCLAUDE_SOCKET: process.env.MYCLAUDE_SOCKET,
      MYCLAUDE_FORCE_STANDALONE: process.env.MYCLAUDE_FORCE_STANDALONE,
    };
    // Point the socket discovery at a path that does not exist so
    // `connectToSocket` rejects immediately rather than hitting any cached
    // dev daemon.
    process.env.MYCLAUDE_SOCKET = join(tmpHome, "no-such.sock");
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    if (originalEnv.MYCLAUDE_SOCKET === undefined) {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.MYCLAUDE_SOCKET;
    } else {
      process.env.MYCLAUDE_SOCKET = originalEnv.MYCLAUDE_SOCKET;
    }
    if (originalEnv.MYCLAUDE_FORCE_STANDALONE === undefined) {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.MYCLAUDE_FORCE_STANDALONE;
    } else {
      process.env.MYCLAUDE_FORCE_STANDALONE = originalEnv.MYCLAUDE_FORCE_STANDALONE;
    }
  });

  it("returns an InProcTransport when no socket exists", async () => {
    const transport = await getTransport({ home: tmpHome });
    try {
      expect(transport).toBeInstanceOf(InProcTransport);
      expect(transport.transportKind).toBe("standalone");
    } finally {
      await transport.close();
    }
  });

  it("returns an InProcTransport when MYCLAUDE_FORCE_STANDALONE=1", async () => {
    process.env.MYCLAUDE_FORCE_STANDALONE = "1";
    const transport = await getTransport({ home: tmpHome });
    try {
      expect(transport.transportKind).toBe("standalone");
    } finally {
      await transport.close();
    }
  });

  it("InProcTransport.close is a no-op (callable multiple times)", async () => {
    const transport = await getTransport({ home: tmpHome });
    await expect(transport.close()).resolves.toBeUndefined();
    await expect(transport.close()).resolves.toBeUndefined();
  });
});

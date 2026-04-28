/**
 * Tests for `daemonStatusService` — pure status aggregator.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { daemonStatusService } from "../src/daemon/status.js";
import { sessionRegistryDir } from "../src/sessions/registry.js";
import type { SessionRecord } from "../src/sessions/registry.js";

function makeRecord(
  sessionsRoot: string,
  sessionId: string,
  status: SessionRecord["status"]
): SessionRecord {
  const sessionDir = join(sessionsRoot, sessionId);
  return {
    version: 1,
    sessionId,
    role: "backend",
    authProfileId: "work",
    cwd: "/repo",
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
    retained: false,
    cleaned: false,
    runtimePaths: {
      sessionDir,
      claudeConfigDir: join(sessionDir, ".claude"),
      mcpConfig: join(sessionDir, "mcp.json"),
      settings: join(sessionDir, "settings.json"),
      apiKeyHelper: null,
      headersHelper: null,
      claudeMd: null,
    },
    spawn: { command: "claude", args: [] },
    status,
  };
}

function writeRecordSync(sessionsRoot: string, record: SessionRecord): void {
  const dir = sessionRegistryDir(sessionsRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.sessionId}.json`), JSON.stringify(record, null, 2));
}

describe("daemonStatusService", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-svc-daemon-"));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("returns pid/socketPath/uptimeMs and zero session counts when registry is empty", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const status = await daemonStatusService({
      pid: 4242,
      socketPath: "/tmp/myclaude.sock",
      startedAtMs: 1_000,
      sessionsRoot,
      nowMs: 31_000,
    });

    expect(status).toEqual({
      pid: 4242,
      socketPath: "/tmp/myclaude.sock",
      uptimeMs: 30_000,
      sessionCounts: { active: 0, total: 0 },
    });
  });

  it("counts active vs total from on-disk session records", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "a", "running"));
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "b", "running"));
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "c", "exited"));
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "d", "failed"));

    const status = await daemonStatusService({
      pid: 1,
      socketPath: "/tmp/x.sock",
      startedAtMs: 0,
      sessionsRoot,
      nowMs: 1_000,
    });

    expect(status.sessionCounts).toEqual({ active: 2, total: 4 });
  });

  it("clamps uptimeMs to 0 when nowMs is before startedAtMs (clock skew)", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const status = await daemonStatusService({
      pid: 1,
      socketPath: "/tmp/x.sock",
      startedAtMs: 5_000,
      sessionsRoot,
      nowMs: 1_000,
    });
    expect(status.uptimeMs).toBe(0);
  });

  it("defaults nowMs to Date.now() when not supplied", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const before = Date.now();
    const status = await daemonStatusService({
      pid: 1,
      socketPath: "/tmp/x.sock",
      startedAtMs: before - 100,
      sessionsRoot,
    });
    expect(status.uptimeMs).toBeGreaterThanOrEqual(100);
  });
});

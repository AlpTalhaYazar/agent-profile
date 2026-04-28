/**
 * Tests for `sessionsListService` and the underlying registry helpers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionsListService } from "../src/sessions/list.js";
import { sessionRegistryDir } from "../src/sessions/registry.js";
import type { SessionRecord } from "../src/sessions/registry.js";

function makeRecord(
  sessionsRoot: string,
  sessionId: string,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  const createdAt = overrides.createdAt ?? "2026-04-24T10:00:00.000Z";
  const sessionDir = join(sessionsRoot, sessionId);
  return {
    version: 1,
    sessionId,
    role: "backend",
    authProfileId: "work",
    cwd: "/repo",
    createdAt,
    updatedAt: createdAt,
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
    spawn: {
      command: "claude",
      args: ["--strict-mcp-config"],
    },
    status: "exited",
    ...overrides,
  };
}

function writeRecordSync(sessionsRoot: string, record: SessionRecord): void {
  const dir = sessionRegistryDir(sessionsRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.sessionId}.json`), JSON.stringify(record, null, 2));
}

describe("sessionsListService", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-svc-sessions-"));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("returns an empty array when the registry dir is missing", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const records = await sessionsListService({ sessionsRoot });
    expect(records).toEqual([]);
  });

  it("returns parsed records sorted by createdAt descending", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    writeRecordSync(
      sessionsRoot,
      makeRecord(sessionsRoot, "older", { createdAt: "2026-04-24T09:00:00.000Z" })
    );
    writeRecordSync(
      sessionsRoot,
      makeRecord(sessionsRoot, "newer", { createdAt: "2026-04-24T10:00:00.000Z" })
    );

    const records = await sessionsListService({ sessionsRoot });
    expect(records.map((r) => r.sessionId)).toEqual(["newer", "older"]);
  });

  it("filters to running sessions when activeOnly is true", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "running-one", { status: "running" }));
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "exited-one", { status: "exited" }));
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "failed-one", { status: "failed" }));

    const records = await sessionsListService({ sessionsRoot, activeOnly: true });
    expect(records.map((r) => r.sessionId)).toEqual(["running-one"]);
  });

  it("silently skips malformed records", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const dir = sessionRegistryDir(sessionsRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.json"), "{ not valid json");
    writeRecordSync(sessionsRoot, makeRecord(sessionsRoot, "good"));

    const records = await sessionsListService({ sessionsRoot });
    expect(records.map((r) => r.sessionId)).toEqual(["good"]);
  });
});

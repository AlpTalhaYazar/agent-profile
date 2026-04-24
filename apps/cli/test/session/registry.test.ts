import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "../../src/errors.js";
import {
  type SessionRecord,
  listSessionRecords,
  readSessionRecord,
  redactCommandArgs,
  sessionRecordPath,
  updateSessionRecord,
  writeSessionRecord,
} from "../../src/session/registry.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "myclaude-registry-"));
}

function makeRecord(sessionId: string, createdAt = "2026-04-24T10:00:00.000Z"): SessionRecord {
  const sessionDir = `/tmp/sessions/${sessionId}`;
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
      claudeConfigDir: `${sessionDir}/.claude`,
      mcpConfig: `${sessionDir}/mcp.json`,
      settings: `${sessionDir}/settings.json`,
      apiKeyHelper: `${sessionDir}/apiKeyHelper.sh`,
      headersHelper: null,
      claudeMd: null,
    },
    spawn: {
      command: "claude",
      args: ["--strict-mcp-config"],
    },
    status: "running",
    startedAt: createdAt,
  };
}

describe("session registry", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("writes, reads, lists, and updates session records atomically", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const older = makeRecord("session-1", "2026-04-24T09:00:00.000Z");
    const newer = makeRecord("session-2", "2026-04-24T10:00:00.000Z");

    await writeSessionRecord({ sessionsRoot, record: older });
    await writeSessionRecord({ sessionsRoot, record: newer });

    expect(statSync(sessionRecordPath(sessionsRoot, "session-1")).mode & 0o777).toBe(0o600);
    await expect(readSessionRecord({ sessionsRoot, sessionId: "session-1" })).resolves.toEqual(
      older
    );
    await expect(listSessionRecords({ sessionsRoot })).resolves.toEqual([newer, older]);

    const updated = await updateSessionRecord({
      sessionsRoot,
      sessionId: "session-1",
      patch: {
        status: "exited",
        exitCode: 7,
        cleaned: true,
        updatedAt: "2026-04-24T09:00:01.000Z",
      },
    });
    expect(updated.status).toBe("exited");
    expect(updated.exitCode).toBe(7);
    expect(updated.cleaned).toBe(true);
  });

  it("redacts likely secret-bearing argv values before metadata persistence", () => {
    expect(
      redactCommandArgs([
        "--prompt",
        "Review PR",
        "--api-key",
        "sk-ant-secret",
        "--token=github-secret",
        "ANTHROPIC_AUTH_TOKEN=secret",
      ])
    ).toEqual([
      "--prompt",
      "Review PR",
      "--api-key",
      "<redacted>",
      "--token=<redacted>",
      "ANTHROPIC_AUTH_TOKEN=<redacted>",
    ]);
  });

  it("rejects path traversal session ids", async () => {
    tempDir = makeTempDir();
    await expect(
      readSessionRecord({ sessionsRoot: join(tempDir, "sessions"), sessionId: "../outside" })
    ).rejects.toBeInstanceOf(CliError);
  });
});

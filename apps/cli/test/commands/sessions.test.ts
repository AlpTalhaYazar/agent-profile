import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSessionsGc, runSessionsList, runSessionsShow } from "../../src/commands/sessions.js";
import {
  type SessionRecord,
  readSessionRecord,
  writeSessionRecord,
} from "../../src/session/registry.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "myclaude-sessions-cmd-"));
}

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
      apiKeyHelper: join(sessionDir, "apiKeyHelper.sh"),
      headersHelper: null,
      claudeMd: null,
    },
    spawn: {
      command: "claude",
      args: ["--strict-mcp-config", "--mcp-config", join(sessionDir, "mcp.json")],
    },
    status: "exited",
    ...overrides,
  };
}

describe("sessions commands", () => {
  let tempDir = "";
  let stdout = "";

  beforeEach(() => {
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
    vi.restoreAllMocks();
  });

  it("lists sessions from the file-backed registry", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-cleaned", {
        role: "frontend",
        authProfileId: "personal",
        cleaned: true,
        createdAt: "2026-04-24T09:46:00.000Z",
        updatedAt: "2026-04-24T09:47:00.000Z",
      }),
    });
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-running", { status: "running" }),
    });

    const records = await runSessionsList({
      sessionsRoot,
      nowMs: Date.parse("2026-04-24T10:00:00.000Z"),
      standalone: true,
    });

    expect(records).toHaveLength(2);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("session-running");
    expect(stdout).toContain("backend");
    expect(stdout).toContain("session-cleaned");
    expect(stdout).toContain("(cleaned)");
    expect(stdout).toContain("14m ago");
  });

  it("shows one session in detail", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-show", {
        exitCode: 7,
        wallMs: 125,
      }),
    });

    await runSessionsShow({ sessionsRoot, sessionId: "session-show" });

    expect(stdout).toContain("ID:       session-show");
    expect(stdout).toContain("Role:     backend");
    expect(stdout).toContain("Exit:     7");
    expect(stdout).toContain("Wall ms:  125");
    expect(stdout).toContain("Command:  claude --strict-mcp-config");
  });

  it("gc cleans exited non-retained dirs and preserves retained/running dirs", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const exited = makeRecord(sessionsRoot, "session-exited");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    const running = makeRecord(sessionsRoot, "session-running", { status: "running" });
    for (const record of [exited, retained, running]) {
      mkdirSync(record.runtimePaths.sessionDir, { recursive: true });
      await writeSessionRecord({ sessionsRoot, record });
    }

    const result = await runSessionsGc({ sessionsRoot });

    expect(result.cleaned).toEqual([
      {
        sessionId: "session-exited",
        sessionDir: exited.runtimePaths.sessionDir,
        source: "registry",
      },
    ]);
    expect(existsSync(exited.runtimePaths.sessionDir)).toBe(false);
    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(true);
    expect(existsSync(running.runtimePaths.sessionDir)).toBe(true);
    expect(await readSessionRecord({ sessionsRoot, sessionId: "session-exited" })).toMatchObject({
      cleaned: true,
    });
    expect(stdout).toContain("Cleaned 1 session dir(s).");
    expect(stdout).toContain("session-retained retained");
    expect(stdout).toContain("session-running running");
  });

  it("gc --all cleans old unregistered orphan dirs under the sessions root", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const orphanDir = join(sessionsRoot, "old-orphan");
    mkdirSync(orphanDir, { recursive: true });
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(orphanDir, old, old);

    const result = await runSessionsGc({ sessionsRoot, all: true });

    expect(result.cleaned).toEqual([
      {
        sessionId: "old-orphan",
        sessionDir: orphanDir,
        source: "orphan",
      },
    ]);
    expect(existsSync(orphanDir)).toBe(false);
  });
});

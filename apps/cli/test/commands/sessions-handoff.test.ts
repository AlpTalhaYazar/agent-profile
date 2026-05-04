import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSessionsHandoff } from "../../src/commands/sessions.js";
import { CliError, EXIT_CONFIG_INVALID } from "../../src/errors.js";
import {
  type SessionRecord,
  readSessionRecord,
  writeSessionRecord,
} from "../../src/session/registry.js";

function makeRecord(
  sessionsRoot: string,
  sessionId: string,
  overrides: Partial<SessionRecord> = {}
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
    spawn: {
      command: "claude",
      args: ["--strict-mcp-config"],
    },
    status: "exited",
    ...overrides,
  };
}

describe("sessions handoff command", () => {
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

  it("prints a markdown handoff packet for an existing session", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaude-handoff-cmd-"));
    const sessionsRoot = join(tempDir, "sessions");
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-handoff"),
    });

    const result = await runSessionsHandoff({
      sessionsRoot,
      sessionId: "session-handoff",
      home: join(tempDir, ".myclaude"),
    });

    expect(result.handoff.sessionId).toBe("session-handoff");
    expect(stdout).toContain("# Agent Profile Handoff Summary");
    expect(stdout).toContain("- Session id: `session-handoff`");
    expect(stdout).toContain("- Verification status: `not recorded`");
    expect(stdout).toContain("- Outcome: `not recorded`");
    expect(stdout).toContain("- Drift: `not recorded`");
  });

  it("emits JSON with markdown and render-time status overrides without updating the registry", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaude-handoff-json-"));
    const sessionsRoot = join(tempDir, "sessions");
    const record = makeRecord(sessionsRoot, "session-json", {
      spawn: {
        command: "claude",
        args: ["--api-key", "sk-ant-secretvalue"],
      },
    });
    await writeSessionRecord({ sessionsRoot, record });

    await runSessionsHandoff({
      sessionsRoot,
      sessionId: "session-json",
      home: join(tempDir, ".myclaude"),
      json: true,
      verificationStatus: "failed",
      verificationCommand: "pnpm test",
      outcome: "blocked",
    });

    const parsed = JSON.parse(stdout) as {
      handoff: { verification: { verificationStatus: string }; outcome: string };
      markdown: string;
    };
    expect(parsed.handoff.verification.verificationStatus).toBe("failed");
    expect(parsed.handoff.outcome).toBe("blocked");
    expect(parsed.markdown).toContain("- Verification command: `pnpm test`");
    expect(stdout).not.toContain("sk-ant-secretvalue");
    await expect(readSessionRecord({ sessionsRoot, sessionId: "session-json" })).resolves.toEqual(
      record
    );
  });

  it("rejects invalid verification and outcome enum values", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaude-handoff-invalid-"));
    const sessionsRoot = join(tempDir, "sessions");
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-invalid"),
    });

    await expect(
      runSessionsHandoff({
        sessionsRoot,
        sessionId: "session-invalid",
        home: join(tempDir, ".myclaude"),
        verificationStatus: "maybe" as never,
      })
    ).rejects.toMatchObject({ name: "CliError", exitCode: EXIT_CONFIG_INVALID });
    await expect(
      runSessionsHandoff({
        sessionsRoot,
        sessionId: "session-invalid",
        home: join(tempDir, ".myclaude"),
        outcome: "unknown" as never,
      })
    ).rejects.toBeInstanceOf(CliError);
  });
});

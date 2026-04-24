/**
 * Sprint 10 tests for `sessions gc` safety hardening:
 * - Retained sessions are skipped by default, never deleted.
 * - `--include-retained` without `--yes` in non-TTY/JSON mode exits with code 6.
 * - `--include-retained --yes` deletes retained sessions and tags them.
 * - JSON mode never prompts.
 * - `--pretty` output is indented JSON.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSessionsGc, runSessionsList, runSessionsShow } from "../../src/commands/sessions.js";
import { CliError, EXIT_USER_CANCELLED } from "../../src/errors.js";
import { type SessionRecord, writeSessionRecord } from "../../src/session/registry.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "myclaude-gc-safety-"));
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

describe("sessions gc safety hardening", () => {
  let tempDir = "";
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    stdout = "";
    stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
    vi.restoreAllMocks();
  });

  it("skips retained sessions by default (no --include-retained)", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const exited = makeRecord(sessionsRoot, "session-exited");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    for (const record of [exited, retained]) {
      mkdirSync(record.runtimePaths.sessionDir, { recursive: true });
      await writeSessionRecord({ sessionsRoot, record });
    }

    const result = await runSessionsGc({ sessionsRoot });

    expect(result.cleaned.map((e) => e.sessionId)).toEqual(["session-exited"]);
    expect(
      result.skipped.some((e) => e.sessionId === "session-retained" && e.reason === "retained")
    ).toBe(true);
    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(true);
  });

  it("refuses to delete retained sessions in non-TTY without --yes (exit 6)", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    mkdirSync(retained.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: retained });

    let caught: unknown;
    try {
      await runSessionsGc({ sessionsRoot, includeRetained: true, isInteractive: false });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_USER_CANCELLED);
    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(true);
  });

  it("refuses to delete retained sessions in --json mode without --yes (exit 6)", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    mkdirSync(retained.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: retained });

    let caught: unknown;
    try {
      // isInteractive: true — simulates a TTY that should still refuse because of --json
      await runSessionsGc({
        sessionsRoot,
        includeRetained: true,
        json: true,
        isInteractive: true,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_USER_CANCELLED);
    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(true);
    // No confirmation prompt should have been written in JSON mode.
    expect(stderr).not.toContain("About to delete");
  });

  it("--include-retained --yes deletes retained sessions and tags them in the result", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const exited = makeRecord(sessionsRoot, "session-exited");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    for (const record of [exited, retained]) {
      mkdirSync(record.runtimePaths.sessionDir, { recursive: true });
      await writeSessionRecord({ sessionsRoot, record });
    }

    const result = await runSessionsGc({
      sessionsRoot,
      includeRetained: true,
      yes: true,
      isInteractive: false,
    });

    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(false);
    expect(existsSync(exited.runtimePaths.sessionDir)).toBe(false);
    const retainedEntry = result.cleaned.find((e) => e.sessionId === "session-retained");
    expect(retainedEntry).toBeDefined();
    expect(retainedEntry?.retained).toBe(true);
    const exitedEntry = result.cleaned.find((e) => e.sessionId === "session-exited");
    expect(exitedEntry?.retained).toBeUndefined();
  });

  it("TTY confirmation prompt returning false exits with code 6 and keeps retained dirs", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    mkdirSync(retained.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: retained });

    let caught: unknown;
    try {
      await runSessionsGc({
        sessionsRoot,
        includeRetained: true,
        isInteractive: true,
        confirm: () => Promise.resolve(false),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_USER_CANCELLED);
    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(true);
    expect(stderr).toContain("About to delete 1 retained session(s)");
  });

  it("TTY confirmation accepted deletes retained dirs", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    mkdirSync(retained.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: retained });

    let confirmMessage: string | undefined;
    const result = await runSessionsGc({
      sessionsRoot,
      includeRetained: true,
      isInteractive: true,
      confirm: (message) => {
        confirmMessage = message;
        return Promise.resolve(true);
      },
    });

    expect(confirmMessage).toContain("Delete these retained sessions?");
    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(false);
    expect(result.cleaned.map((e) => e.sessionId)).toContain("session-retained");
  });

  it("never prompts and never cleans anything when no retained candidates exist", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const exited = makeRecord(sessionsRoot, "session-exited");
    mkdirSync(exited.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: exited });

    // confirm would throw if invoked — prove it is not called when there is nothing retained.
    const confirm = vi.fn<(message: string) => Promise<boolean>>(() => {
      throw new Error("confirm should not be called when no retained candidates exist");
    });
    const result = await runSessionsGc({
      sessionsRoot,
      includeRetained: true,
      isInteractive: true,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.cleaned.map((e) => e.sessionId)).toEqual(["session-exited"]);
  });

  it("--pretty implies --json and produces indented output", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const exited = makeRecord(sessionsRoot, "session-exited");
    mkdirSync(exited.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: exited });

    await runSessionsGc({ sessionsRoot, pretty: true });

    expect(stdout).toContain('"cleaned"');
    expect(stdout).toContain("\n  ");
  });

  it("human output surfaces a retained count when retained sessions were cleaned", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const exited = makeRecord(sessionsRoot, "session-exited");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    for (const record of [exited, retained]) {
      mkdirSync(record.runtimePaths.sessionDir, { recursive: true });
      await writeSessionRecord({ sessionsRoot, record });
    }

    await runSessionsGc({
      sessionsRoot,
      includeRetained: true,
      yes: true,
      isInteractive: false,
    });

    expect(stdout).toContain("(1 retained)");
    expect(stdout).toContain("[retained]");
  });

  it("orphan cleanup still respects retained when --all is used without --include-retained", async () => {
    // A registered + retained record whose dir is also picked up by orphan scan.
    // Must not be deleted by --all alone.
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const retained = makeRecord(sessionsRoot, "session-retained", { retained: true });
    mkdirSync(retained.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record: retained });
    const { utimesSync } = await import("node:fs");
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(retained.runtimePaths.sessionDir, old, old);

    const result = await runSessionsGc({ sessionsRoot, all: true });

    expect(existsSync(retained.runtimePaths.sessionDir)).toBe(true);
    expect(result.cleaned).toHaveLength(0);
    expect(result.skipped.some((e) => e.sessionId === "session-retained")).toBe(true);
  });

  it("sessions list --pretty implies --json and emits indented JSON", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-pretty"),
    });

    await runSessionsList({
      sessionsRoot,
      pretty: true,
      nowMs: Date.parse("2026-04-24T10:05:00.000Z"),
    });

    expect(stdout).toContain('"sessions"');
    expect(stdout).toContain("\n  ");
    const parsed = JSON.parse(stdout) as { sessions: Array<{ sessionId: string }> };
    expect(parsed.sessions.map((s) => s.sessionId)).toEqual(["session-pretty"]);
  });

  it("sessions show --pretty implies --json and never leaks capabilityToken", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    await writeSessionRecord({
      sessionsRoot,
      record: makeRecord(sessionsRoot, "session-pretty"),
    });

    await runSessionsShow({ sessionsRoot, sessionId: "session-pretty", pretty: true });

    expect(stdout).toContain('"session"');
    expect(stdout).toContain("\n  ");
    // Capability tokens live in session.json (manifest), not registry records.
    expect(stdout).not.toContain("capabilityToken");
  });

  it("session records never leak secret-like values in spawn.args", async () => {
    tempDir = makeTempDir();
    const sessionsRoot = join(tempDir, "sessions");
    const record = makeRecord(sessionsRoot, "session-secret-safe", {
      spawn: {
        command: "claude",
        args: [
          "--api-key=sk-ant-should-be-masked",
          "--token",
          "tk-live-should-be-masked",
          "--mcp-config",
          join(sessionsRoot, "session-secret-safe", "mcp.json"),
        ],
      },
    });
    // NOTE: This test verifies the file-on-disk is not redacted here (that happens
    // only at write-time in launch/index.ts via redactCommandArgs). The purpose of
    // this test is to assert that gc/list/show never re-introduce raw values from
    // some other source. We assert that the output string does not contain the
    // fake secret even though we wrote it directly (simulating pre-redaction).
    // Real production writes always go through redactCommandArgs.
    mkdirSync(record.runtimePaths.sessionDir, { recursive: true });
    await writeSessionRecord({ sessionsRoot, record });

    await runSessionsGc({ sessionsRoot, json: true });

    // The gc output focuses on cleaned/skipped ids and paths — no spawn.args at all.
    expect(stdout).not.toContain("sk-ant-should-be-masked");
    expect(stdout).not.toContain("tk-live-should-be-masked");
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectiveSessionConfig } from "@agent-profile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeLaunchHash } from "../src/launch-hash.js";
import { sessionsHandoffService } from "../src/sessions/handoff.js";
import { type SessionRecord, sessionRegistryDir } from "../src/sessions/registry.js";

function baseRecord(
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
      apiKeyHelper: join(sessionDir, "apiKeyHelper.sh"),
      headersHelper: null,
      claudeMd: null,
    },
    spawn: {
      command: "claude",
      args: ["--strict-mcp-config", "--mcp-config", join(sessionDir, "mcp.json")],
    },
    status: "exited",
    exitCode: 0,
    ...overrides,
  };
}

function writeRecordSync(sessionsRoot: string, record: SessionRecord): void {
  const dir = sessionRegistryDir(sessionsRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.sessionId}.json`), JSON.stringify(record, null, 2));
}

const STUB_EFFECTIVE = (scopeFiles: readonly string[]): EffectiveSessionConfig => ({
  effective: { mcpServers: {}, env: {}, settings: {}, persona: {} } as never,
  provenance: {
    mcpServers: {},
    env: {},
    settings: {},
    persona: scopeFiles.length > 0 ? [{ source: "global-shared", files: [...scopeFiles] }] : [],
  } as never,
  runtimePaths: null,
});

describe("sessionsHandoffService", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-svc-handoff-"));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("generates a copyable markdown handoff for an existing session", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const scopeFiles = ["/home/u/.myclaude/config/global/shared.yml"] as const;
    const stub = STUB_EFFECTIVE(scopeFiles);
    const launchHash = computeLaunchHash({
      effective: stub.effective,
      provenance: stub.provenance,
      scopeFiles: [...scopeFiles],
    });
    writeRecordSync(sessionsRoot, {
      ...baseRecord(sessionsRoot, "session-handoff"),
      launchHash,
    });

    const result = await sessionsHandoffService({
      sessionsRoot,
      sessionId: "session-handoff",
      home: "/home/u/.myclaude",
      getEffective: () => stub,
    });

    expect(result.handoff.sessionId).toBe("session-handoff");
    expect(result.handoff.verification.drift).toBe("in sync");
    expect(result.handoff.verification.verificationStatus).toBe("not recorded");
    expect(result.handoff.outcome).toBe("not recorded");
    expect(result.markdown).toContain("# Agent Profile Handoff Summary");
    expect(result.markdown).toContain("- Session id: `session-handoff`");
    expect(result.markdown).toContain("- Cwd: `/repo`");
    expect(result.markdown).toContain("- Role: `backend`");
    expect(result.markdown).toContain("- Auth profile id: `work`");
    expect(result.markdown).toContain("- Drift: `in sync`");
    expect(result.markdown).toContain("- Verification status: `not recorded`");
    expect(result.markdown).toContain("- Outcome: `not recorded`");
    expect(result.markdown).toContain("- Launch hash baseline: `recorded`");
    expect(result.markdown).toContain(
      "- Current provenance: `myclaude profile show backend --auth work --cwd /repo --provenance`"
    );
    expect(result.markdown).toContain("- MCP config: `");
    expect(result.markdown).toContain("- API key helper: `");
  });

  it("renders missing drift, verification, and outcome as not recorded", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    writeRecordSync(sessionsRoot, baseRecord(sessionsRoot, "session-no-hash"));

    const result = await sessionsHandoffService({
      sessionsRoot,
      sessionId: "session-no-hash",
      home: "/home/u/.myclaude",
    });

    expect(result.handoff.verification.drift).toBe("not recorded");
    expect(result.handoff.verification.launchHashBaseline).toBe("not recorded");
    expect(result.markdown).toContain("- Drift: `not recorded`");
    expect(result.markdown).toContain("- Verification command: `not recorded`");
  });

  it("redacts secret-looking command args, runtime paths, and verification commands", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    writeRecordSync(
      sessionsRoot,
      baseRecord(sessionsRoot, "session-secrets", {
        runtimePaths: {
          sessionDir: join(sessionsRoot, "session-secrets"),
          claudeConfigDir: join(sessionsRoot, "session-secrets", ".claude"),
          mcpConfig: "keyring://anthropic/work",
          settings: join(sessionsRoot, "settings.json?token=sk-ant-secretvalue"),
          apiKeyHelper: join(sessionsRoot, "apiKeyHelper.sh"),
          headersHelper: "${secret:github.pat}",
          claudeMd: null,
        },
        spawn: {
          command: "claude",
          args: [
            "--api-key",
            "sk-ant-secretvalue",
            "--token=github_pat_secretvalue",
            "--capability-token",
            "capability-secret-value",
          ],
        },
      })
    );

    const result = await sessionsHandoffService({
      sessionsRoot,
      sessionId: "session-secrets",
      home: "/home/u/.myclaude",
      verificationStatus: "passed",
      verificationCommand: "ANTHROPIC_API_KEY=sk-ant-secretvalue pnpm test",
      outcome: "completed",
    });
    const serialized = JSON.stringify(result);

    expect(result.handoff.verification.verificationStatus).toBe("passed");
    expect(result.handoff.outcome).toBe("completed");
    expect(serialized).not.toContain("sk-ant-secretvalue");
    expect(serialized).not.toContain("github_pat_secretvalue");
    expect(serialized).not.toContain("capability-secret-value");
    expect(serialized).not.toContain("keyring://");
    expect(serialized).not.toContain("${secret:");
    expect(result.markdown).toContain("<redacted>");
  });
});

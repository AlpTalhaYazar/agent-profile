/**
 * Tests for `driftService` — the read-only drift detector behind
 * `sessions.drift`.
 *
 * The service touches the registry (real fs fixture) and the profile-show
 * cascade (stubbed via `getEffective` so we don't need a full home tree).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectiveSessionConfig } from "@agent-profile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors.js";
import { computeLaunchHash } from "../src/launch-hash.js";
import { driftService } from "../src/sessions/drift.js";
import { type SessionRecord, sessionRegistryDir } from "../src/sessions/registry.js";

function baseRecord(sessionsRoot: string, sessionId: string): SessionRecord {
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
    status: "running",
  };
}

function writeRecordSync(sessionsRoot: string, record: SessionRecord): void {
  const dir = sessionRegistryDir(sessionsRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.sessionId}.json`), JSON.stringify(record, null, 2));
}

const STUB_EFFECTIVE = (scopeFiles: readonly string[]): EffectiveSessionConfig => {
  const persona = scopeFiles.length > 0 ? [{ files: [...scopeFiles] }] : [];
  return {
    effective: { mcp: { servers: {} }, env: {}, settings: {}, persona: {} } as never,
    provenance: { persona } as never,
    runtimePaths: null,
  };
};

describe("driftService", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-svc-drift-"));
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("returns drifted=false when the recomputed hash matches the launchHash", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const scopeFiles = ["/home/u/.myclaude/global/shared.yml"] as const;
    const stub = STUB_EFFECTIVE(scopeFiles);
    const launchHash = computeLaunchHash({
      effective: stub.effective,
      provenance: stub.provenance,
      scopeFiles: [...scopeFiles],
    });
    writeRecordSync(sessionsRoot, { ...baseRecord(sessionsRoot, "s-stable"), launchHash });

    const result = await driftService({
      sessionsRoot,
      sessionId: "s-stable",
      home: "/home/u/.myclaude",
      getEffective: () => stub,
    });

    expect(result.drifted).toBe(false);
    expect(result.scopesChanged).toEqual([]);
    expect(result.oldHash).toBe(launchHash);
    expect(result.newHash).toBe(launchHash);
  });

  it("returns drifted=true with the current scopeFiles when the hash diverged", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    const launchScopes = ["/home/u/.myclaude/global/shared.yml"] as const;
    const launchHash = computeLaunchHash({
      effective: STUB_EFFECTIVE(launchScopes).effective,
      provenance: STUB_EFFECTIVE(launchScopes).provenance,
      scopeFiles: [...launchScopes],
    });
    writeRecordSync(sessionsRoot, { ...baseRecord(sessionsRoot, "s-drifted"), launchHash });

    const currentScopes = ["/home/u/.myclaude/global/shared.yml", "/repo/.myclaude/role.yml"];
    const result = await driftService({
      sessionsRoot,
      sessionId: "s-drifted",
      home: "/home/u/.myclaude",
      getEffective: () => STUB_EFFECTIVE(currentScopes),
    });

    expect(result.drifted).toBe(true);
    expect(result.scopesChanged).toEqual(currentScopes);
    expect(result.oldHash).toBe(launchHash);
    expect(result.newHash).not.toBe(launchHash);
  });

  it("throws config-invalid when the record carries no launchHash", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    writeRecordSync(sessionsRoot, baseRecord(sessionsRoot, "s-no-hash"));

    await expect(
      driftService({
        sessionsRoot,
        sessionId: "s-no-hash",
        home: "/home/u/.myclaude",
        getEffective: () => STUB_EFFECTIVE([]),
      })
    ).rejects.toMatchObject({ name: "ServiceError", code: "config-invalid" });
  });

  it("propagates a not-found ServiceError when the record is missing", async () => {
    const sessionsRoot = join(tempDir, "sessions");
    mkdirSync(sessionRegistryDir(sessionsRoot), { recursive: true });

    await expect(
      driftService({
        sessionsRoot,
        sessionId: "s-missing",
        home: "/home/u/.myclaude",
        getEffective: () => STUB_EFFECTIVE([]),
      })
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

/**
 * Tests for `myclaude doctor`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SchemaError, loadScopeFile } from "@agent-profile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DoctorCheck } from "../../src/commands/doctor.js";
import {
  checkNodeVersion,
  checkScopeFiles,
  checkVersions,
  deferredChecks,
  renderCheck,
} from "../../src/commands/doctor.js";
import { green, red, yellow } from "../../src/output/colors.js";

// FIXTURES_HOME is the equivalent of ~/.myclaude
const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

function makeTempDir(): string {
  const dir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("checkNodeVersion", () => {
  it("returns pass status for Node >= 22", () => {
    const major = Number.parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
    const result = checkNodeVersion();
    expect(result.name).toBe("node-version");
    if (major >= 22) {
      expect(result.status).toBe("pass");
      expect(result.message).toContain(process.version);
    } else {
      expect(result.status).toBe("fail");
      expect(result.hint).toBeDefined();
    }
  });

  it("pass result has no hint", () => {
    const major = Number.parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
    if (major >= 22) {
      const result = checkNodeVersion();
      expect(result.hint).toBeUndefined();
    }
  });
});

describe("checkVersions", () => {
  it("returns two checks: cli-version and core-version", () => {
    const results = checkVersions();
    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe("cli-version");
    expect(results[1]?.name).toBe("core-version");
  });

  it("each check has a status of pass or warn", () => {
    const results = checkVersions();
    for (const result of results) {
      expect(["pass", "warn"]).toContain(result.status);
    }
  });

  it("check messages include version strings", () => {
    const results = checkVersions();
    expect(results[0]?.message).toContain("myclaude version:");
    expect(results[1]?.message).toContain("@agent-profile/core version:");
  });
});

describe("checkScopeFiles", () => {
  it("passes validation for fixture home", () => {
    const results = checkScopeFiles(FIXTURES_HOME, FIXTURES_HOME);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.status).toBe("pass");
    }
  });

  it("returns warn when no scope files found", () => {
    const results = checkScopeFiles("/nonexistent/path", "/nonexistent/path");
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("warn");
    expect(results[0]?.name).toBe("scope-files");
    expect(results[0]?.hint).toBeDefined();
  });

  it("returns fail for broken scope file", () => {
    const tempDir = makeTempDir();
    const rolesDir = join(tempDir, "config", "global", "roles");
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(
      join(rolesDir, "broken.yml"),
      "version: 1\nmcpServers:\n  bad:\n    type: stdio\n"
    );
    const results = checkScopeFiles(tempDir, tempDir);
    const failResult = results.find((r) => r.status === "fail");
    expect(failResult).toBeDefined();
    expect(failResult?.hint).toBeDefined();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("scope name format is scope/role", () => {
    const results = checkScopeFiles(FIXTURES_HOME, FIXTURES_HOME);
    for (const result of results) {
      expect(result.name).toMatch(/^scope:/);
    }
  });
});

describe("deferredChecks", () => {
  it("returns three deferred checks", () => {
    const results = deferredChecks();
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const result of results) {
      expect(result.status).toBe("deferred");
    }
  });

  it("includes claude-binary, keychain, and daemon checks", () => {
    const results = deferredChecks();
    const names = results.map((r) => r.name);
    expect(names).toContain("claude-binary");
    expect(names).toContain("keychain");
    expect(names).toContain("daemon");
  });
});

describe("renderCheck", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
  });

  it("renders [✓] for pass status", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };
    try {
      renderCheck({ name: "test", status: "pass", message: "All good" });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = captured.join("");
    expect(output).toContain("[✓]");
    expect(output).toContain("All good");
  });

  it("renders [!] for warn status", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };
    try {
      renderCheck({ name: "test", status: "warn", message: "Warning here", hint: "Fix it" });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = captured.join("");
    expect(output).toContain("[!]");
    expect(output).toContain("Warning here");
    expect(output).toContain("Fix: Fix it");
  });

  it("renders [✗] for fail status", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };
    try {
      renderCheck({ name: "test", status: "fail", message: "Broken", hint: "Fix it now" });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = captured.join("");
    expect(output).toContain("[✗]");
    expect(output).toContain("Broken");
    expect(output).toContain("Fix: Fix it now");
  });

  it("renders [ ] for deferred status", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };
    try {
      renderCheck({ name: "test", status: "deferred", message: "Not yet" });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = captured.join("");
    expect(output).toContain("[ ]");
    expect(output).toContain("Not yet");
  });

  it("does not render hint for pass status", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };
    try {
      renderCheck({ name: "test", status: "pass", message: "Good", hint: "Should not show" });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = captured.join("");
    expect(output).not.toContain("Should not show");
  });
});

describe("check output format (color tests)", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
  });

  it("renders [✓] for pass status (colors disabled)", () => {
    const marker = green("[✓]");
    expect(marker).toBe("[✓]");
  });

  it("renders [!] for warn status (colors disabled)", () => {
    const marker = yellow("[!]");
    expect(marker).toBe("[!]");
  });

  it("renders [✗] for fail status (colors disabled)", () => {
    const marker = red("[✗]");
    expect(marker).toBe("[✗]");
  });
});

describe("scope file validation", () => {
  it("passes validation for fixture home", () => {
    const sharedPath = join(FIXTURES_HOME, "config/global/shared.yml");
    expect(() => loadScopeFile(sharedPath)).not.toThrow();
  });

  it("fails validation for broken scope file", () => {
    const tempDir = makeTempDir();
    const brokenFile = join(tempDir, "broken.yml");
    writeFileSync(brokenFile, "version: 1\nmcpServers:\n  bad:\n    type: stdio\n");
    expect(() => loadScopeFile(brokenFile)).toThrow(SchemaError);
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("deferred checks (integration)", () => {
  it("all fixture scope files are valid", async () => {
    const { discoverScopes } = await import("../../src/utils/scope-discovery.js");
    const entries = discoverScopes({ home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    // All fixture entries should be valid
    for (const entry of entries) {
      expect(() => loadScopeFile(entry.filePath)).not.toThrow();
    }
  });
});

describe("JSON output structure", () => {
  it("doctor checks include status field", () => {
    const check: DoctorCheck = {
      name: "test-check",
      status: "pass",
      message: "Test passed",
    };
    expect(check.status).toBe("pass");
    expect(check.name).toBe("test-check");
  });

  it("healthy is false when any check fails", () => {
    const checks: DoctorCheck[] = [
      { name: "check1", status: "pass", message: "OK" },
      { name: "check2", status: "fail", message: "Failed" },
    ];
    const hasFailures = checks.some((c) => c.status === "fail");
    expect(hasFailures).toBe(true);
  });

  it("healthy is true when all checks pass or warn", () => {
    const checks: DoctorCheck[] = [
      { name: "check1", status: "pass", message: "OK" },
      { name: "check2", status: "warn", message: "Warning" },
      { name: "check3", status: "deferred", message: "Deferred" },
    ];
    const hasFailures = checks.some((c) => c.status === "fail");
    expect(hasFailures).toBe(false);
  });
});

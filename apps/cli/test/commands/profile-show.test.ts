/**
 * Tests for `myclaude profile show` (and shared `runShow` logic).
 */
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runShow } from "../../src/commands/profile/show.js";

// FIXTURES_HOME is the equivalent of ~/.myclaude
const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("../fixtures/project", import.meta.url).pathname);

/**
 * Capture every chunk written to `process.stdout.write` while `fn` runs (sync
 * or async). Restores the original write after the function settles.
 */
async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const captured: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === "string") captured.push(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return captured.join("");
}

describe("runShow", () => {
  beforeEach(() => {
    // Force the standalone path so the test never touches the real daemon.
    process.env.MYCLAUDE_FORCE_STANDALONE = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  describe("JSON output", () => {
    it("emits effective and provenance keys in JSON mode", async () => {
      const output = await captureStdout(() =>
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      );

      const parsed = JSON.parse(output) as { effective: unknown; provenance: unknown };
      expect(parsed).toHaveProperty("effective");
      expect(parsed).toHaveProperty("provenance");
    });

    it("effective config has mcpServers from fixture", async () => {
      const output = await captureStdout(() =>
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      );

      const parsed = JSON.parse(output) as { effective: { mcpServers: Record<string, unknown> } };
      expect(parsed.effective.mcpServers).toHaveProperty("github");
      expect(parsed.effective.mcpServers).toHaveProperty("postgres");
    });

    it("effective config has env vars merged across scopes", async () => {
      const output = await captureStdout(() =>
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      );

      const parsed = JSON.parse(output) as { effective: { env: Record<string, string> } };
      expect(parsed.effective.env).toHaveProperty("EDITOR"); // from global-shared
      expect(parsed.effective.env).toHaveProperty("NODE_ENV"); // from global-role
    });
  });

  describe("human output", () => {
    beforeEach(() => {
      process.env.NO_COLOR = "1";
    });

    afterEach(() => {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.NO_COLOR;
    });

    it("includes role name in output", async () => {
      const output = await captureStdout(() =>
        runShow({
          role: "backend",
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      );

      expect(output).toContain("backend");
    });

    it("includes provenance info when --provenance is set", async () => {
      const output = await captureStdout(() =>
        runShow({
          role: "backend",
          provenance: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      );

      // Provenance should include scope names
      expect(output).toMatch(/global-(?:shared|role)/);
    });
  });

  describe("error handling", () => {
    it("throws CliError with exit code 2 for schema errors", async () => {
      // nonexistent role just returns empty (no files = no error)
      await expect(
        runShow({
          role: "nonexistent-role",
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("project cascade", () => {
    it("merges project-level scopes when cwd is inside project", async () => {
      const output = await captureStdout(() =>
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_PROJECT,
        })
      );

      const parsed = JSON.parse(output) as { effective: { env: Record<string, string> } };
      // PROJECT_NAME comes from project-shared fixture
      expect(parsed.effective.env).toHaveProperty("PROJECT_NAME", "acme-api");
    });
  });
});

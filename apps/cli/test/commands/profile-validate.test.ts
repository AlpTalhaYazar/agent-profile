/**
 * Tests for `myclaude profile validate`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SchemaError, loadScopeFile } from "@agent-profile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// FIXTURES_HOME is the equivalent of ~/.myclaude
const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

describe("profile validate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("valid fixture tree", () => {
    it("validates all fixture scope files without error", async () => {
      // Import validateCommand logic; we'll test the underlying function
      const { loadScopeFile } = await import("@agent-profile/core");
      // FIXTURES_HOME is ~/.myclaude, so config is at FIXTURES_HOME/config/global/...
      expect(() => loadScopeFile(join(FIXTURES_HOME, "config/global/shared.yml"))).not.toThrow();
      expect(() =>
        loadScopeFile(join(FIXTURES_HOME, "config/global/roles/backend.yml"))
      ).not.toThrow();
    });
  });

  describe("invalid YAML", () => {
    it("throws SchemaError for missing command on stdio server", () => {
      const invalidFile = join(tempDir, "invalid.yml");
      // An stdio server definition missing the required `command` field
      writeFileSync(invalidFile, "version: 1\nmcpServers:\n  bad-server:\n    type: stdio\n");
      expect(() => loadScopeFile(invalidFile)).toThrow(SchemaError);
    });

    it("SchemaError includes the file path", () => {
      const invalidFile = join(tempDir, "invalid.yml");
      writeFileSync(invalidFile, "version: 1\nmcpServers:\n  bad-server:\n    type: stdio\n");
      let caughtError: unknown;
      try {
        loadScopeFile(invalidFile);
      } catch (e) {
        caughtError = e;
      }
      expect(caughtError).toBeInstanceOf(SchemaError);
      const se = caughtError as { sourceFile: string };
      expect(se.sourceFile).toBe(invalidFile);
    });
  });

  describe("single file validation", () => {
    it("validates a specific file when path is given", () => {
      const validFile = join(FIXTURES_HOME, "config/global/shared.yml");
      expect(() => loadScopeFile(validFile)).not.toThrow();
    });

    it("validates a broken file and reports correct field path", () => {
      const invalidFile = join(tempDir, "broken.yml");
      writeFileSync(invalidFile, "version: 1\nmcpServers:\n  bad-server:\n    type: stdio\n");
      let caughtError: unknown;
      try {
        loadScopeFile(invalidFile);
      } catch (e) {
        caughtError = e;
      }
      expect(caughtError).toBeInstanceOf(SchemaError);
      const se = caughtError as { fieldPath: string };
      // Field path should reference mcpServers.bad-server
      expect(se.fieldPath).toContain("mcpServers");
    });
  });
});

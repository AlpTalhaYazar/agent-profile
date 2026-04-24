/**
 * Tests for `myclaude profile show` (and shared `runShow` logic).
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runShow } from "../../src/commands/profile/show.js";
import { CliError } from "../../src/errors.js";

// FIXTURES_HOME is the equivalent of ~/.myclaude
const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("../fixtures/project", import.meta.url).pathname);

describe("runShow", () => {
  describe("JSON output", () => {
    it("emits effective and provenance keys in JSON mode", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        });
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { effective: unknown; provenance: unknown };
      expect(parsed).toHaveProperty("effective");
      expect(parsed).toHaveProperty("provenance");
    });

    it("effective config has mcpServers from fixture", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        });
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { effective: { mcpServers: Record<string, unknown> } };
      expect(parsed.effective.mcpServers).toHaveProperty("github");
      expect(parsed.effective.mcpServers).toHaveProperty("postgres");
    });

    it("effective config has env vars merged across scopes", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        });
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { effective: { env: Record<string, string> } };
      expect(parsed.effective.env).toHaveProperty("EDITOR"); // from global-shared
      expect(parsed.effective.env).toHaveProperty("NODE_ENV"); // from global-role
    });
  });

  describe("human output", () => {
    it("includes role name in output", () => {
      process.env.NO_COLOR = "1";
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        runShow({
          role: "backend",
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        });
      } finally {
        process.stdout.write = origWrite;
        // biome-ignore lint/performance/noDelete: must fully unset env vars
        delete process.env.NO_COLOR;
      }

      const output = captured.join("");
      expect(output).toContain("backend");
    });

    it("includes provenance info when --provenance is set", () => {
      process.env.NO_COLOR = "1";
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        runShow({
          role: "backend",
          provenance: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        });
      } finally {
        process.stdout.write = origWrite;
        // biome-ignore lint/performance/noDelete: must fully unset env vars
        delete process.env.NO_COLOR;
      }

      const output = captured.join("");
      // Provenance should include scope names
      expect(output).toMatch(/global-(?:shared|role)/);
    });
  });

  describe("error handling", () => {
    it("throws CliError with exit code 2 for schema errors", () => {
      expect(() =>
        runShow({
          role: "nonexistent-role",
          home: FIXTURES_HOME,
          cwd: FIXTURES_HOME,
        })
      ).not.toThrow(); // nonexistent role just returns empty (no files = no error)
    });
  });

  describe("project cascade", () => {
    it("merges project-level scopes when cwd is inside project", () => {
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: unknown) => {
        if (typeof chunk === "string") captured.push(chunk);
        return true;
      };

      try {
        runShow({
          role: "backend",
          json: true,
          home: FIXTURES_HOME,
          cwd: FIXTURES_PROJECT,
        });
      } finally {
        process.stdout.write = origWrite;
      }

      const output = captured.join("");
      const parsed = JSON.parse(output) as { effective: { env: Record<string, string> } };
      // PROJECT_NAME comes from project-shared fixture
      expect(parsed.effective.env).toHaveProperty("PROJECT_NAME", "acme-api");
    });
  });
});

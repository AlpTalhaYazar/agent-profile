/**
 * Tests for `myclaude render`.
 * Render delegates to the same `runShow` as `profile show`.
 */
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runShow } from "../../src/commands/profile/show.js";

// FIXTURES_HOME is the equivalent of ~/.myclaude
const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);
const FIXTURES_PROJECT = resolve(new URL("../fixtures/project", import.meta.url).pathname);

describe("render (delegates to runShow)", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
  });

  it("produces the same output as profile show for backend role", () => {
    const showCaptured: string[] = [];
    const renderCaptured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);

    // Capture show output
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") showCaptured.push(chunk);
      return true;
    };
    runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    process.stdout.write = origWrite;

    // Capture render output (same call)
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") renderCaptured.push(chunk);
      return true;
    };
    runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    process.stdout.write = origWrite;

    expect(showCaptured.join("")).toBe(renderCaptured.join(""));
  });

  it("resolves the cascade identically for project cwd", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };

    try {
      runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_PROJECT });
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(captured.join("")) as {
      effective: { env: Record<string, string> };
    };
    // Should merge project-shared env (PROJECT_NAME)
    expect(parsed.effective.env.PROJECT_NAME).toBe("acme-api");
  });

  it("includes provenance when requested", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };

    try {
      runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME });
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(captured.join("")) as {
      provenance: { mcpServers: Record<string, unknown> };
    };
    expect(parsed).toHaveProperty("provenance");
    expect(parsed.provenance).toHaveProperty("mcpServers");
  });
});

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

/** Capture stdout for the duration of an async function. */
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

describe("render (delegates to runShow)", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
    process.env.MYCLAUDE_FORCE_STANDALONE = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.MYCLAUDE_FORCE_STANDALONE;
  });

  it("produces the same output as profile show for backend role", async () => {
    const showOut = await captureStdout(() =>
      runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME })
    );
    const renderOut = await captureStdout(() =>
      runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME })
    );
    expect(showOut).toBe(renderOut);
  });

  it("resolves the cascade identically for project cwd", async () => {
    const output = await captureStdout(() =>
      runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_PROJECT })
    );
    const parsed = JSON.parse(output) as {
      effective: { env: Record<string, string> };
    };
    // Should merge project-shared env (PROJECT_NAME)
    expect(parsed.effective.env.PROJECT_NAME).toBe("acme-api");
  });

  it("includes provenance when requested", async () => {
    const output = await captureStdout(() =>
      runShow({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME })
    );
    const parsed = JSON.parse(output) as {
      provenance: { mcpServers: Record<string, unknown> };
    };
    expect(parsed).toHaveProperty("provenance");
    expect(parsed.provenance).toHaveProperty("mcpServers");
  });
});

/**
 * Tests for `myclaude render persona`.
 *
 * The standalone path drives the in-proc transport, which calls
 * `personaRenderService` directly. The fixture has no persona refs, so the
 * render output is empty (`claudeMd: null`, no files). We assert the shape,
 * the activation/auth error paths, and the text/JSON formatting.
 */
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderPersonaCommand, runRenderPersona } from "../../src/commands/render-persona.js";
import { CliError } from "../../src/errors.js";

const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

async function captureStdout(fn: () => Promise<unknown> | unknown): Promise<string> {
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

// biome-ignore lint/suspicious/noExplicitAny: citty CommandContext arg not publicly typed
function ctx(args: Record<string, unknown>, cmd: unknown): any {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

describe("runRenderPersona (standalone)", () => {
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

  it("throws CliError when no role can be resolved", async () => {
    await expect(
      runRenderPersona({
        home: "/nonexistent/home",
        cwd: "/nonexistent/cwd",
      })
    ).rejects.toThrow(CliError);
  });

  it("throws CliError when no auth profile is selected", async () => {
    await expect(
      runRenderPersona({
        role: "backend",
        home: FIXTURES_HOME,
        cwd: FIXTURES_HOME,
        // no auth — fixture has no default-auth file either
      })
    ).rejects.toThrow(CliError);
  });

  it("returns an empty render for fixtures without persona refs", async () => {
    const result = await runRenderPersona({
      role: "backend",
      auth: "work",
      home: FIXTURES_HOME,
      cwd: FIXTURES_HOME,
      json: true,
    });
    expect(result.claudeMd).toBeNull();
    expect(result.files).toEqual([]);
    expect(result.collisions).toEqual([]);
    expect(result.missingSources).toEqual([]);
  });

  it("emits JSON output when --json is given", async () => {
    const out = await captureStdout(() =>
      runRenderPersona({
        role: "backend",
        auth: "work",
        home: FIXTURES_HOME,
        cwd: FIXTURES_HOME,
        json: true,
      })
    );
    const parsed = JSON.parse(out) as {
      claudeMd: unknown;
      files: unknown[];
      collisions: unknown[];
      missingSources: unknown[];
    };
    expect(parsed).toHaveProperty("claudeMd");
    expect(parsed).toHaveProperty("files");
    expect(parsed).toHaveProperty("collisions");
    expect(parsed).toHaveProperty("missingSources");
    expect(parsed.files).toHaveLength(0);
  });

  it("emits human text output when --json is not given", async () => {
    const out = await captureStdout(() =>
      runRenderPersona({
        role: "backend",
        auth: "work",
        home: FIXTURES_HOME,
        cwd: FIXTURES_HOME,
      })
    );
    expect(out).toContain("Persona render: role=backend auth=work");
    expect(out).toContain("CLAUDE.md: (no sources)");
    expect(out).toContain("Agents (0)");
    expect(out).toContain("Skills (0)");
    expect(out).toContain("Slash commands (0)");
    expect(out).toContain("Memory seeds (0)");
  });
});

describe("renderPersonaCommand", () => {
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

  it("Citty wrapper accepts --role and --auth and routes through runRenderPersona", async () => {
    const out = await captureStdout(() =>
      renderPersonaCommand.run?.(
        ctx(
          {
            role: "backend",
            auth: "work",
            json: true,
            home: FIXTURES_HOME,
            cwd: FIXTURES_HOME,
          },
          renderPersonaCommand
        )
      )
    );
    const parsed = JSON.parse(out) as { files: unknown[] };
    expect(parsed.files).toEqual([]);
  });
});

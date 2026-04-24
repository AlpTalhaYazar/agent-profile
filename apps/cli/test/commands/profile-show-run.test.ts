/**
 * Tests for `profileShowCommand.run` to cover the command wrapper.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileShowCommand } from "../../src/commands/profile/show.js";
import { CliError } from "../../src/errors.js";

const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

function makeTempDir(): string {
  const dir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  };
  const restore = () => {
    process.stdout.write = orig;
  };
  const result = fn();
  if (result instanceof Promise) {
    return result.then(
      () => {
        restore();
        return chunks.join("");
      },
      (err) => {
        restore();
        throw err;
      }
    );
  }
  restore();
  return Promise.resolve(chunks.join(""));
}

// Helper to build a valid citty CommandContext with required `_` field.
// Returns `unknown` so callers can cast with `as Parameters<...>`.
function ctx(args: Record<string, unknown>, cmd: unknown): unknown {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

// Typed cast helper: avoids spreading `as any` casts across test bodies.
const asCtx = (c: unknown) => c as Parameters<NonNullable<typeof profileShowCommand.run>>[0];

describe("profileShowCommand.run", () => {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must fully unset env vars
    delete process.env.NO_COLOR;
  });

  it("renders human output for backend role", async () => {
    const output = await captureStdout(() =>
      profileShowCommand.run?.(
        asCtx(
          ctx(
            {
              role: "backend",
              json: false,
              pretty: false,
              provenance: false,
              home: FIXTURES_HOME,
              cwd: FIXTURES_HOME,
            },
            profileShowCommand
          )
        )
      )
    );
    expect(output).toContain("backend");
  });

  it("renders JSON output for backend role", async () => {
    const output = await captureStdout(() =>
      profileShowCommand.run?.(
        asCtx(
          ctx(
            {
              role: "backend",
              json: true,
              pretty: false,
              provenance: false,
              home: FIXTURES_HOME,
              cwd: FIXTURES_HOME,
            },
            profileShowCommand
          )
        )
      )
    );
    const parsed = JSON.parse(output) as { effective: unknown; provenance: unknown };
    expect(parsed).toHaveProperty("effective");
    expect(parsed).toHaveProperty("provenance");
  });

  it("throws CliError when role arg is missing", () => {
    expect(() =>
      profileShowCommand.run?.(
        asCtx(
          ctx(
            {
              role: "",
              json: false,
              pretty: false,
              provenance: false,
              home: FIXTURES_HOME,
              cwd: FIXTURES_HOME,
            },
            profileShowCommand
          )
        )
      )
    ).toThrow(CliError);
  });

  it("throws CliError when scope file is invalid", () => {
    const tempDir = makeTempDir();
    const rolesDir = join(tempDir, "config", "global", "roles");
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(
      join(rolesDir, "broken.yml"),
      "version: 1\nmcpServers:\n  bad:\n    type: stdio\n"
    );
    expect(() =>
      profileShowCommand.run?.(
        asCtx(
          ctx(
            {
              role: "broken",
              json: false,
              pretty: false,
              provenance: false,
              home: tempDir,
              cwd: tempDir,
            },
            profileShowCommand
          )
        )
      )
    ).toThrow(CliError);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("renders pretty JSON when --pretty is set", async () => {
    const output = await captureStdout(() =>
      profileShowCommand.run?.(
        asCtx(
          ctx(
            {
              role: "backend",
              json: true,
              pretty: true,
              provenance: false,
              home: FIXTURES_HOME,
              cwd: FIXTURES_HOME,
            },
            profileShowCommand
          )
        )
      )
    );
    // Pretty JSON has newlines and indentation
    expect(output).toContain("\n");
    expect(output).toContain("  ");
  });
});

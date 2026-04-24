/**
 * Tests for `renderCommand.run` to cover the command wrapper.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCommand } from "../../src/commands/render.js";
import { CliError } from "../../src/errors.js";

const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

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

// Helper to build a valid citty CommandContext with required `_` field
// biome-ignore lint/suspicious/noExplicitAny: citty CommandContext arg not publicly typed
function ctx(args: Record<string, unknown>, cmd: unknown): any {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

describe("renderCommand.run", () => {
  it("throws CliError when no role can be resolved", async () => {
    // Use a temp home with no default-role and no env vars
    await expect(
      renderCommand.run?.(
        ctx({ json: false, home: "/nonexistent/home", cwd: "/nonexistent/cwd" }, renderCommand)
      )
    ).rejects.toThrow(CliError);
  });

  it("renders JSON output when --role and --json are given", async () => {
    const output = await captureStdout(() =>
      renderCommand.run?.(
        ctx({ role: "backend", json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME }, renderCommand)
      )
    );
    const parsed = JSON.parse(output) as { effective: unknown; provenance: unknown };
    expect(parsed).toHaveProperty("effective");
    expect(parsed).toHaveProperty("provenance");
  });

  it("renders human output when --role is given", async () => {
    process.env.NO_COLOR = "1";
    try {
      const output = await captureStdout(() =>
        renderCommand.run?.(
          ctx(
            { role: "backend", json: false, home: FIXTURES_HOME, cwd: FIXTURES_HOME },
            renderCommand
          )
        )
      );
      expect(output).toContain("backend");
    } finally {
      // biome-ignore lint/performance/noDelete: must fully unset env vars
      delete process.env.NO_COLOR;
    }
  });
});

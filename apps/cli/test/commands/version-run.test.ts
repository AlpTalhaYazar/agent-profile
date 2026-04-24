/**
 * Tests for `versionCommand.run` to cover the command wrapper.
 */
import { describe, expect, it } from "vitest";
import { versionCommand } from "../../src/commands/version.js";

function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  };
  const result = fn();
  if (result instanceof Promise) {
    return result.then(
      () => {
        process.stdout.write = orig;
        return chunks.join("");
      },
      (err) => {
        process.stdout.write = orig;
        throw err;
      }
    );
  }
  process.stdout.write = orig;
  return Promise.resolve(chunks.join(""));
}

// Helper to build a valid citty CommandContext with required `_` field
// biome-ignore lint/suspicious/noExplicitAny: citty CommandContext arg not publicly typed
function ctx(args: Record<string, unknown>, cmd: unknown): any {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

describe("versionCommand.run", () => {
  it("prints human-readable version info", async () => {
    const output = await captureStdout(() =>
      versionCommand.run?.(ctx({ json: false }, versionCommand))
    );
    expect(output).toContain("myclaude");
    expect(output).toContain("core");
    expect(output).toContain("node");
    expect(output).toContain(process.version);
  });

  it("emits JSON when --json flag is set", async () => {
    const output = await captureStdout(() =>
      versionCommand.run?.(ctx({ json: true }, versionCommand))
    );
    const parsed = JSON.parse(output) as { cli: string; core: string; node: string };
    expect(parsed).toHaveProperty("cli");
    expect(parsed).toHaveProperty("core");
    expect(parsed).toHaveProperty("node");
    expect(parsed.node).toBe(process.version);
  });
});

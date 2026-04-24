/**
 * Tests for `doctorCommand.run` to cover the command wrapper.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../src/commands/doctor.js";

const FIXTURES_HOME = resolve(new URL("../fixtures/home/.myclaude", import.meta.url).pathname);

function captureOutput(
  fn: () => void | Promise<void>
): Promise<{ stdout: string; stderr: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === "string") outChunks.push(chunk);
    return true;
  };
  process.stderr.write = (chunk: unknown) => {
    if (typeof chunk === "string") errChunks.push(chunk);
    return true;
  };
  const restore = () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
  const result = fn();
  if (result instanceof Promise) {
    return result.then(
      () => {
        restore();
        return { stdout: outChunks.join(""), stderr: errChunks.join("") };
      },
      (err) => {
        restore();
        throw err;
      }
    );
  }
  restore();
  return Promise.resolve({ stdout: outChunks.join(""), stderr: errChunks.join("") });
}

// Helper to build a valid citty CommandContext with required `_` field
// biome-ignore lint/suspicious/noExplicitAny: citty CommandContext arg not publicly typed
function ctx(args: Record<string, unknown>, cmd: unknown): any {
  return { args: { _: [], ...args }, cmd, rawArgs: [], subCommand: undefined };
}

describe("doctorCommand.run", () => {
  it("runs in human mode with fixture home", async () => {
    const { stdout } = await captureOutput(() =>
      doctorCommand.run?.(
        ctx({ json: false, home: FIXTURES_HOME, cwd: FIXTURES_HOME }, doctorCommand)
      )
    );
    // Should contain check markers
    expect(stdout).toMatch(/\[.+\]/);
  });

  it("runs in JSON mode with fixture home", async () => {
    const { stdout } = await captureOutput(() =>
      doctorCommand.run?.(
        ctx({ json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME }, doctorCommand)
      )
    );
    const parsed = JSON.parse(stdout) as { checks: unknown[]; healthy: boolean };
    expect(parsed).toHaveProperty("checks");
    expect(parsed).toHaveProperty("healthy");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.healthy).toBe(true);
  });

  it("JSON output includes node-version check", async () => {
    const { stdout } = await captureOutput(() =>
      doctorCommand.run?.(
        ctx({ json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME }, doctorCommand)
      )
    );
    const parsed = JSON.parse(stdout) as { checks: Array<{ name: string }> };
    const names = parsed.checks.map((c) => c.name);
    expect(names).toContain("node-version");
    expect(names).toContain("cli-version");
    expect(names).toContain("core-version");
  });

  it("includes deferred checks in output", async () => {
    const { stdout } = await captureOutput(() =>
      doctorCommand.run?.(
        ctx({ json: true, home: FIXTURES_HOME, cwd: FIXTURES_HOME }, doctorCommand)
      )
    );
    const parsed = JSON.parse(stdout) as { checks: Array<{ name: string; status: string }> };
    const deferred = parsed.checks.filter((c) => c.status === "deferred");
    expect(deferred.length).toBeGreaterThan(0);
  });

  it("non-JSON mode with failures writes diagnostic message and calls process.exit(1)", async () => {
    // Create a temp home with a broken scope file to trigger a fail check.
    const tempHome = join(
      tmpdir(),
      `doctor-run-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const rolesDir = join(tempHome, "config", "global", "roles");
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(
      join(rolesDir, "broken.yml"),
      "version: 1\nmcpServers:\n  bad:\n    type: stdio\n" // missing required 'command' field
    );

    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as unknown as typeof process.exit);

    let stdout = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") stdout += chunk;
      return true;
    };

    try {
      await expect(
        doctorCommand.run?.(ctx({ json: false, home: tempHome, cwd: tempHome }, doctorCommand))
      ).rejects.toThrow("process.exit called");
    } finally {
      process.stdout.write = origWrite;
      exitSpy.mockRestore();
      rmSync(tempHome, { recursive: true, force: true });
    }

    expect(stdout).toContain("Diagnostics found issues");
    expect(exitCode).toBe(1);
  });
});

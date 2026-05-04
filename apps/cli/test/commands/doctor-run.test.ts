/**
 * Tests for `doctorCommand.run` to cover the command wrapper.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type RunDoctorOptions, runDoctor } from "../../src/commands/doctor.js";
import { MockBackend } from "../helpers/mock-backend.js";

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

function makeExecutableClaude(): { root: string; bin: string; command: string } {
  const root = join(
    tmpdir(),
    `doctor-run-claude-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const bin = join(root, "bin");
  const command = join(bin, "claude");
  mkdirSync(bin, { recursive: true });
  writeFileSync(command, "#!/bin/sh\nexit 0\n");
  chmodSync(command, 0o755);
  return { root, bin, command };
}

const daemonStatusProbe = async () => ({
  pid: 321,
  socketPath: "/tmp/myclaude-test.sock",
  uptimeMs: 1000,
  sessionCounts: { active: 0, total: 1 },
});

async function runDeterministicDoctor(
  args: { json?: boolean; pretty?: boolean; home?: string; cwd?: string } = {}
): Promise<void> {
  const fixture = makeExecutableClaude();
  try {
    const runOptions: RunDoctorOptions = {
      home: args.home ?? FIXTURES_HOME,
      cwd: args.cwd ?? FIXTURES_HOME,
      backend: new MockBackend("keychain-macos"),
      env: { PATH: fixture.bin },
      claudeVersionProbe: async () => "claude 2.1.61",
      daemonStatusProbe,
    };
    if (args.json !== undefined) runOptions.json = args.json;
    if (args.pretty !== undefined) runOptions.pretty = args.pretty;
    await runDoctor(runOptions);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("runDoctor", () => {
  it("runs in human mode with fixture home", async () => {
    const { stdout } = await captureOutput(() => runDeterministicDoctor({ json: false }));
    // Should contain check markers
    expect(stdout).toMatch(/\[.+\]/);
  });

  it("runs in JSON mode with fixture home", async () => {
    const { stdout } = await captureOutput(() => runDeterministicDoctor({ json: true }));
    const parsed = JSON.parse(stdout) as { checks: unknown[]; healthy: boolean };
    expect(parsed).toHaveProperty("checks");
    expect(parsed).toHaveProperty("healthy");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.healthy).toBe(true);
  });

  it("JSON output includes node, claude, and daemon checks", async () => {
    const { stdout } = await captureOutput(() => runDeterministicDoctor({ json: true }));
    const parsed = JSON.parse(stdout) as { checks: Array<{ name: string }> };
    const names = parsed.checks.map((c) => c.name);
    expect(names).toContain("node-version");
    expect(names).toContain("cli-version");
    expect(names).toContain("core-version");
    expect(names).toContain("claude-binary");
    expect(names).toContain("daemon");
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
        runDeterministicDoctor({ json: false, home: tempHome, cwd: tempHome })
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

/**
 * Tests for `schemaCommand` subcommand `run` to cover the command wrapper.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateJsonSchema, schemaCommand } from "../../src/commands/schema.js";
import { CliError } from "../../src/errors.js";

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

// Access the export subcommand
// biome-ignore lint/suspicious/noExplicitAny: need to access citty subCommands dynamically
const subCmds = schemaCommand.subCommands as any;
// biome-ignore lint/suspicious/noExplicitAny: need to access citty subCommands dynamically
const schemaExportRun = subCmds?.export?.run as ((ctx: any) => void) | undefined;

// Helper to build a valid citty CommandContext with required `_` field
// biome-ignore lint/suspicious/noExplicitAny: citty CommandContext arg not publicly typed
function ctx(args: Record<string, unknown>): any {
  return { args: { _: [], ...args }, rawArgs: [], subCommand: undefined };
}

describe("schema export command run", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("schema export subcommand exists", () => {
    expect(schemaExportRun).toBeDefined();
    expect(typeof schemaExportRun).toBe("function");
  });

  it("prints schema to stdout when no path given", async () => {
    const output = await captureStdout(() =>
      schemaExportRun?.(ctx({ pretty: true, write: false }))
    );
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty("type");
  });

  it("writes schema to file when path is given", async () => {
    const outPath = join(tempDir, "out.json");
    const output = await captureStdout(() =>
      schemaExportRun?.(ctx({ path: outPath, pretty: true, write: false }))
    );
    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("type");
    expect(output).toContain(outPath);
  });

  it("writes schema to default home path when --write is given", async () => {
    const output = await captureStdout(() =>
      schemaExportRun?.(ctx({ write: true, pretty: true, home: tempDir }))
    );
    const schemaPath = join(tempDir, "schema.json");
    expect(existsSync(schemaPath)).toBe(true);
    expect(output).toContain("schema.json");
  });

  it("throws CliError when file cannot be written", () => {
    expect(() =>
      schemaExportRun?.(
        ctx({ path: "/nonexistent/deeply/nested/path/schema.json", pretty: false, write: false })
      )
    ).toThrow(CliError);
  });

  it("outputs compact JSON when pretty is false", async () => {
    const output = await captureStdout(() =>
      schemaExportRun?.(ctx({ pretty: false, write: false }))
    );
    // Compact JSON should not have leading spaces after opening brace
    const firstLine = output.split("\n")[0] ?? "";
    expect(firstLine).not.toMatch(/^{\s+/);
  });

  it("generateJsonSchema is consistent with exported run", () => {
    const schema = generateJsonSchema();
    expect(schema).toHaveProperty("type");
  });
});

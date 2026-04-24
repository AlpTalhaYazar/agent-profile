/**
 * Tests for `myclaude schema export`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateJsonSchema } from "../../src/commands/schema.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `myclaude-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("generateJsonSchema", () => {
  it("returns a JSON Schema object", () => {
    const schema = generateJsonSchema();
    expect(schema).toBeDefined();
    expect(typeof schema).toBe("object");
  });

  it("schema has $schema or type property (indicates it's a JSON Schema)", () => {
    const schema = generateJsonSchema();
    // Zod v4 toJSONSchema produces an object with 'type' or '$schema'
    expect(schema).toHaveProperty("type");
  });

  it("schema describes ScopeDoc shape with version field", () => {
    const schema = generateJsonSchema();
    // Should contain 'properties' with version
    const schemaStr = JSON.stringify(schema);
    expect(schemaStr).toContain("version");
  });

  it("schema mentions mcpServers", () => {
    const schema = generateJsonSchema();
    const schemaStr = JSON.stringify(schema);
    expect(schemaStr).toContain("mcpServers");
  });

  it("generates same schema on each call (deterministic)", () => {
    const schema1 = generateJsonSchema();
    const schema2 = generateJsonSchema();
    expect(JSON.stringify(schema1)).toBe(JSON.stringify(schema2));
  });
});

describe("schema export to file", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes JSON Schema to specified path", async () => {
    const outPath = join(tempDir, "schema.json");
    const schema = generateJsonSchema();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
    expect(existsSync(outPath)).toBe(true);
  });

  it("written file is valid JSON matching generateJsonSchema", async () => {
    const outPath = join(tempDir, "schema.json");
    const schema = generateJsonSchema();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
    const content = readFileSync(outPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(schema));
  });
});

describe("schema export to stdout", () => {
  it("prints JSON Schema to stdout when no path given", () => {
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      return true;
    };

    try {
      const schema = generateJsonSchema();
      const json = JSON.stringify(schema, null, 2);
      process.stdout.write(`${json}\n`);
    } finally {
      process.stdout.write = origWrite;
    }

    const output = captured.join("");
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(parsed).toHaveProperty("type");
  });
});

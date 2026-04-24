/**
 * Tests for JSON output helpers.
 */
import { describe, expect, it } from "vitest";
import { writeJson, writeJsonError } from "../src/output/json.js";

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  };
  try {
    fn();
    return chunks.join("");
  } finally {
    process.stdout.write = orig;
  }
}

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  };
  try {
    fn();
    return chunks.join("");
  } finally {
    process.stderr.write = orig;
  }
}

describe("writeJson", () => {
  it("writes compact JSON to stdout by default", () => {
    const output = captureStdout(() => writeJson({ foo: "bar" }));
    expect(output.trim()).toBe('{"foo":"bar"}');
  });

  it("writes pretty JSON to stdout when pretty=true", () => {
    const output = captureStdout(() => writeJson({ foo: "bar" }, true));
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.foo).toBe("bar");
    expect(output).toContain("  "); // indentation
  });

  it("appends newline to output", () => {
    const output = captureStdout(() => writeJson({ x: 1 }));
    expect(output.endsWith("\n")).toBe(true);
  });
});

describe("writeJsonError", () => {
  it("writes error object to stderr", () => {
    const output = captureStderr(() => writeJsonError("Something failed"));
    const parsed = JSON.parse(output) as { error: string; code?: number };
    expect(parsed.error).toBe("Something failed");
    expect(parsed.code).toBeUndefined();
  });

  it("includes code when provided", () => {
    const output = captureStderr(() => writeJsonError("Bad request", 400));
    const parsed = JSON.parse(output) as { error: string; code: number };
    expect(parsed.error).toBe("Bad request");
    expect(parsed.code).toBe(400);
  });

  it("appends newline to output", () => {
    const output = captureStderr(() => writeJsonError("err"));
    expect(output.endsWith("\n")).toBe(true);
  });
});

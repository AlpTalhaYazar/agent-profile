/**
 * Tests for the `myclaude-helper` CLI runner.
 *
 * The runner is dependency-injected: these tests exercise it with a mock
 * `HelperClient` and in-memory streams, so no real keychain, filesystem,
 * or process state is touched.
 *
 * Invariants asserted throughout:
 *  - `run` never throws; every path resolves with a numeric exit code.
 *  - On success, stdout receives exactly one write (the returned value, no
 *    trailing newline for values; JSON without whitespace for headers).
 *  - On any failure, stdout is empty — values must never leak alongside
 *    error messages.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import type { HelperClient } from "../src/client/types.js";
import {
  EXIT_CAPABILITY_DENIED,
  EXIT_GENERIC,
  EXIT_OK,
  EXIT_USAGE,
  HelperError,
} from "../src/errors.js";

/** Fixed fake version string used throughout these tests. */
const FAKE_VERSION = "9.9.9-test";

/** NUL character, expressed without embedding a literal NUL in source. */
const NUL = String.fromCharCode(0);
/** DEL character (0x7f). */
const DEL = String.fromCharCode(0x7f);

/** Captures a `PassThrough` stream's output as a UTF-8 string. */
function mkStreams(): {
  stdout: PassThrough;
  stderr: PassThrough;
  readOut: () => string;
  readErr: () => string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: string[] = [];
  const err: string[] = [];
  stdout.on("data", (c: Buffer) => out.push(c.toString("utf8")));
  stderr.on("data", (c: Buffer) => err.push(c.toString("utf8")));
  return {
    stdout,
    stderr,
    readOut: () => out.join(""),
    readErr: () => err.join(""),
  };
}

/** Builds a `HelperClient` double whose methods are vi spies. */
function mkClient(overrides: Partial<HelperClient> = {}): HelperClient {
  return {
    anthropic: vi.fn(async () => "api-key-sentinel"),
    mcpHeaders: vi.fn(async () => ({ Authorization: "Bearer xxx" })),
    ...overrides,
  };
}

describe("run — anthropic subcommand", () => {
  it("writes the key verbatim to stdout and returns 0", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess-1", "tok-abc"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    expect(readOut()).toBe("api-key-sentinel");
    expect(readOut().endsWith("\n")).toBe(false);
    expect(readErr()).toBe("");
    expect(client.anthropic).toHaveBeenCalledTimes(1);
    expect(client.anthropic).toHaveBeenCalledWith({
      sessionId: "sess-1",
      capabilityToken: "tok-abc",
    });
  });

  it("rejects wrong arity (too few) without calling the client", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess-only"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("myclaude-helper anthropic");
    expect(client.anthropic).not.toHaveBeenCalled();
  });

  it("rejects wrong arity (too many) without calling the client", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "a", "b", "extra"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("myclaude-helper anthropic");
    expect(client.anthropic).not.toHaveBeenCalled();
  });
});

describe("run — mcp-headers subcommand", () => {
  it("writes compact JSON to stdout and returns 0", async () => {
    const client = mkClient({
      mcpHeaders: vi.fn(async () => ({ Authorization: "Bearer xxx", "X-Trace": "abc" })),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["mcp-headers", "sess-1", "tok-abc", "linear"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    const body = readOut();
    expect(body.endsWith("\n")).toBe(false);
    expect(() => JSON.parse(body)).not.toThrow();
    expect(JSON.parse(body)).toEqual({ Authorization: "Bearer xxx", "X-Trace": "abc" });
    // JSON.stringify with no space argument produces compact output.
    expect(body).toBe('{"Authorization":"Bearer xxx","X-Trace":"abc"}');
    expect(readErr()).toBe("");
    expect(client.mcpHeaders).toHaveBeenCalledTimes(1);
    expect(client.mcpHeaders).toHaveBeenCalledWith({
      sessionId: "sess-1",
      capabilityToken: "tok-abc",
      serverName: "linear",
    });
  });

  it("rejects wrong arity (too few) without calling the client", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["mcp-headers", "s", "t"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("myclaude-helper mcp-headers");
    expect(client.mcpHeaders).not.toHaveBeenCalled();
  });

  it("rejects wrong arity (too many) without calling the client", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["mcp-headers", "a", "b", "c", "d"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("myclaude-helper mcp-headers");
    expect(client.mcpHeaders).not.toHaveBeenCalled();
  });
});

describe("run — help and version", () => {
  it("--help writes usage to stdout and returns 0", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["--help"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    expect(readOut()).toContain("Usage:");
    expect(readOut()).toContain("anthropic");
    expect(readOut()).toContain("mcp-headers");
    expect(readOut().endsWith("\n")).toBe(true);
    expect(readErr()).toBe("");
    expect(client.anthropic).not.toHaveBeenCalled();
    expect(client.mcpHeaders).not.toHaveBeenCalled();
  });

  it("-h writes usage to stdout and returns 0", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["-h"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    expect(readOut()).toContain("Usage:");
    expect(readErr()).toBe("");
  });

  it("--version writes the version string with trailing newline", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["--version"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    expect(readOut()).toBe(`${FAKE_VERSION}\n`);
    expect(readErr()).toBe("");
  });

  it("-V writes the version string with trailing newline", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["-V"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    expect(readOut()).toBe(`${FAKE_VERSION}\n`);
    expect(readErr()).toBe("");
  });
});

describe("run — argv routing failures", () => {
  it("no args returns EXIT_USAGE and writes usage to stderr", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: [],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("Usage:");
    expect(client.anthropic).not.toHaveBeenCalled();
    expect(client.mcpHeaders).not.toHaveBeenCalled();
  });

  it("unknown command reports the command on stderr and returns EXIT_USAGE", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["bogus", "x", "y"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("unknown command: bogus");
    expect(readErr()).toContain("Usage:");
    expect(client.anthropic).not.toHaveBeenCalled();
    expect(client.mcpHeaders).not.toHaveBeenCalled();
  });
});

describe("run — positional validation", () => {
  it("rejects NUL in a positional without calling the client", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", `sess${NUL}`, "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("control character");
    expect(client.anthropic).not.toHaveBeenCalled();
  });

  it("rejects newline in a positional without calling the client", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", "tok\nwith-newline"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("control character");
    expect(client.anthropic).not.toHaveBeenCalled();
  });

  it("rejects carriage return in a positional", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["mcp-headers", "sess", "tok", "server\rname"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("control character");
    expect(client.mcpHeaders).not.toHaveBeenCalled();
  });

  it("rejects DEL (0x7f) in a positional", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", `tok${DEL}`],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("control character");
    expect(client.anthropic).not.toHaveBeenCalled();
  });

  it("rejects tab (0x09) in a positional", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess\ttab", "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("control character");
    expect(client.anthropic).not.toHaveBeenCalled();
  });

  it("rejects empty string positional", async () => {
    const client = mkClient();
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "", "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("empty");
    expect(client.anthropic).not.toHaveBeenCalled();
  });
});

describe("run — error mapping", () => {
  it("maps HelperError to its exitCode and writes message to stderr", async () => {
    const client = mkClient({
      anthropic: vi.fn(async () => {
        throw new HelperError("capability token denied for session", EXIT_CAPABILITY_DENIED);
      }),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", "bad-tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_CAPABILITY_DENIED);
    expect(code).toBe(6);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("capability token denied for session");
    expect(readErr().endsWith("\n")).toBe(true);
  });

  it("maps a generic Error to EXIT_GENERIC with its message on stderr", async () => {
    const client = mkClient({
      anthropic: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_GENERIC);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("boom");
  });

  it("maps a non-Error throw to EXIT_GENERIC with stringified value on stderr", async () => {
    const client = mkClient({
      anthropic: vi.fn(async () => {
        throw "raw string failure";
      }),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_GENERIC);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("raw string failure");
  });

  it("maps errors from mcp-headers the same way", async () => {
    const client = mkClient({
      mcpHeaders: vi.fn(async () => {
        throw new HelperError("unknown session: sess-x", 5);
      }),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["mcp-headers", "sess-x", "tok", "linear"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(5);
    expect(readOut()).toBe("");
    expect(readErr()).toContain("unknown session: sess-x");
  });
});

describe("run — stdout/stderr discipline", () => {
  it("on error, stdout is empty even if the client had a return value staged", async () => {
    // The client throws before any stdout write can happen; stdout must stay
    // pristine so Claude Code never sees a partial value.
    const client = mkClient({
      anthropic: vi.fn(async () => {
        throw new HelperError("nope", EXIT_CAPABILITY_DENIED);
      }),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_CAPABILITY_DENIED);
    expect(readOut()).toBe("");
    expect(readErr().length).toBeGreaterThan(0);
  });

  it("on success, stderr is empty — secrets never leak sideways", async () => {
    // Plant a distinctive sentinel and assert it only appears on stdout.
    const sentinel = "sk-super-secret-sentinel-42";
    const client = mkClient({
      anthropic: vi.fn(async () => sentinel),
    });
    const { stdout, stderr, readOut, readErr } = mkStreams();

    const code = await run({
      argv: ["anthropic", "sess", "tok"],
      client,
      stdout,
      stderr,
      version: FAKE_VERSION,
    });

    expect(code).toBe(EXIT_OK);
    expect(readOut()).toBe(sentinel);
    expect(readErr()).toBe("");
    expect(readErr()).not.toContain(sentinel);
  });

  it("run never throws — even when client throws a number", async () => {
    const client = mkClient({
      mcpHeaders: vi.fn(async () => {
        throw 42;
      }),
    });
    const { stdout, stderr, readOut } = mkStreams();

    await expect(
      run({
        argv: ["mcp-headers", "sess", "tok", "srv"],
        client,
        stdout,
        stderr,
        version: FAKE_VERSION,
      })
    ).resolves.toBe(EXIT_GENERIC);
    expect(readOut()).toBe("");
  });
});

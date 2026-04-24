/**
 * @module cli
 *
 * Pure, testable runner for the `myclaude-helper` binary.
 *
 * The runner validates argv, routes to the provided `HelperClient`, and writes
 * output exclusively to the injected `stdout`/`stderr` streams. It must never
 * throw: any error is captured and mapped to a numeric exit code.
 *
 * Security posture:
 *  - Values returned by the client are written verbatim to stdout with no
 *    trailing whitespace. They are never logged, mirrored, or included in
 *    error messages.
 *  - On any error path stdout is left untouched; error text only reaches
 *    stderr. This keeps Claude Code's `apiKeyHelper` / `headersHelper`
 *    contracts clean even when a failure happens mid-operation.
 *  - Positional arguments are strictly validated: empty strings, NUL, newlines,
 *    carriage returns, and other control characters are rejected at the argv
 *    boundary so the client never receives tainted input.
 */
import type { HelperClient } from "./client/types.js";
import { EXIT_GENERIC, EXIT_OK, EXIT_USAGE, HelperError } from "./errors.js";

/** Options passed to {@link run}. */
export interface RunOptions {
  /** Argv WITHOUT node/binary — i.e. what `process.argv.slice(2)` returns. */
  readonly argv: readonly string[];
  /** The HelperClient that services routed subcommands. */
  readonly client: HelperClient;
  /** Output stream for values (Anthropic key / headers JSON). */
  readonly stdout: NodeJS.WritableStream;
  /** Output stream for errors only. */
  readonly stderr: NodeJS.WritableStream;
  /** Helper version string (from tsup define). */
  readonly version: string;
}

/** Usage string written to stdout (for `--help`) or stderr (for usage errors). */
const USAGE = `Usage:
  myclaude-helper anthropic   <sessionId> <capabilityToken>
  myclaude-helper mcp-headers <sessionId> <capabilityToken> <serverName>
  myclaude-helper --help | --version
`;

/**
 * Short per-subcommand usage line emitted on arity errors.
 *
 * Kept separate from {@link USAGE} so a wrong-arity failure surfaces only the
 * minimal form Claude Code operators need to correct their invocation.
 */
const USAGE_MINI: Record<"anthropic" | "mcp-headers", string> = {
  anthropic: "usage: myclaude-helper anthropic <sessionId> <capabilityToken>\n",
  "mcp-headers": "usage: myclaude-helper mcp-headers <sessionId> <capabilityToken> <serverName>\n",
};

/**
 * Validates a single positional argument.
 *
 * Returns the validated string on success, or `null` on failure (after writing
 * a descriptive error to `stderr`). A positional is considered invalid if it
 * is empty, `undefined`, or contains any control character (codepoint `< 0x20`
 * or `=== 0x7f`). This explicitly forbids NUL, LF, and CR which would
 * otherwise corrupt the helper's single-line stdout contract.
 *
 * @param name - Human-readable positional name (for the error message).
 * @param value - The raw argv entry to validate.
 * @param stderr - Stream to write the rejection reason to.
 */
function sanitizePositional(
  name: string,
  value: string | undefined,
  stderr: NodeJS.WritableStream
): string | null {
  if (value === undefined || value.length === 0) {
    stderr.write(`invalid ${name}: empty\n`);
    return null;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      stderr.write(`invalid ${name}: contains control character\n`);
      return null;
    }
  }
  return value;
}

/**
 * Maps an unknown caught value to an exit code and writes a one-line message
 * to `stderr`.
 *
 * `HelperError` instances preserve their `exitCode`; plain `Error` instances
 * and other throw values fall back to {@link EXIT_GENERIC}. Error messages
 * from `HelperClient` implementations are expected to be secret-free by
 * contract (see `client/types.ts`).
 */
function handleError(err: unknown, stderr: NodeJS.WritableStream): number {
  if (err instanceof HelperError) {
    stderr.write(`${err.message}\n`);
    return err.exitCode;
  }
  if (err instanceof Error) {
    stderr.write(`${err.message}\n`);
    return EXIT_GENERIC;
  }
  stderr.write(`${String(err)}\n`);
  return EXIT_GENERIC;
}

/**
 * Executes the helper CLI.
 *
 * Contract:
 *  - Never throws. Returns a numeric exit code the caller should pass to
 *    `process.exit`.
 *  - Writes values only to `opts.stdout` and errors only to `opts.stderr`.
 *  - On success: exactly one write to stdout (the returned value, no trailing
 *    newline) and no writes to stderr.
 *  - On any failure path: no writes to stdout; one (or rarely two) writes to
 *    stderr describing the failure.
 *
 * @param opts - Injected dependencies and argv.
 * @returns The process exit code.
 */
export async function run(opts: RunOptions): Promise<number> {
  const { argv, client, stdout, stderr, version } = opts;

  const head = argv[0];

  if (head === undefined) {
    stderr.write(USAGE);
    return EXIT_USAGE;
  }

  if (head === "--help" || head === "-h") {
    stdout.write(USAGE);
    return EXIT_OK;
  }

  if (head === "--version" || head === "-V") {
    stdout.write(`${version}\n`);
    return EXIT_OK;
  }

  if (head === "anthropic") {
    if (argv.length !== 3) {
      stderr.write(USAGE_MINI.anthropic);
      return EXIT_USAGE;
    }
    const sessionId = sanitizePositional("sessionId", argv[1], stderr);
    if (sessionId === null) return EXIT_USAGE;
    const capabilityToken = sanitizePositional("capabilityToken", argv[2], stderr);
    if (capabilityToken === null) return EXIT_USAGE;

    try {
      const value = await client.anthropic({ sessionId, capabilityToken });
      stdout.write(value);
      return EXIT_OK;
    } catch (err) {
      return handleError(err, stderr);
    }
  }

  if (head === "mcp-headers") {
    if (argv.length !== 4) {
      stderr.write(USAGE_MINI["mcp-headers"]);
      return EXIT_USAGE;
    }
    const sessionId = sanitizePositional("sessionId", argv[1], stderr);
    if (sessionId === null) return EXIT_USAGE;
    const capabilityToken = sanitizePositional("capabilityToken", argv[2], stderr);
    if (capabilityToken === null) return EXIT_USAGE;
    const serverName = sanitizePositional("serverName", argv[3], stderr);
    if (serverName === null) return EXIT_USAGE;

    try {
      const headers = await client.mcpHeaders({ sessionId, capabilityToken, serverName });
      stdout.write(JSON.stringify(headers));
      return EXIT_OK;
    } catch (err) {
      return handleError(err, stderr);
    }
  }

  stderr.write(`unknown command: ${head}\n`);
  stderr.write(USAGE);
  return EXIT_USAGE;
}

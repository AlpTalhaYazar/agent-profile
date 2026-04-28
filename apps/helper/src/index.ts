/**
 * @module index
 *
 * Entry point for the `myclaude-helper` binary.
 *
 * Resolution order:
 *  1. **Daemon path** — when the IPC socket is reachable and the cookie is
 *     readable, use {@link createIpcHelperClient}. The daemon owns
 *     `safeStorage`; it returns the secret over the wire as base64.
 *  2. **In-process fallback** — when the daemon is absent, unreachable, or
 *     the user forced standalone (`MYCLAUDE_FORCE_STANDALONE=1`), drop into
 *     {@link createInProcessHelperClient} which reads the OS keychain
 *     directly. This preserves Phase 1 semantics for users without the
 *     desktop app.
 *
 * The shebang (`#!/usr/bin/env node`) is injected by tsup's `banner` option.
 * `__HELPER_VERSION__` is replaced at bundle time by tsup's `define` option.
 */
import { run } from "./cli.js";
import { createInProcessHelperClient } from "./client/in-process.js";
import { createIpcHelperClient } from "./client/ipc-client.js";
import type { HelperClient } from "./client/types.js";
import { EXIT_INTERRUPTED } from "./errors.js";

/** Build-time constant injected by tsup's `define` option. */
declare const __HELPER_VERSION__: string;

process.on("SIGINT", () => {
  process.stderr.write("\n");
  process.exit(EXIT_INTERRUPTED);
});

const client = await selectHelperClient();
const exitCode = await run({
  argv: process.argv.slice(2),
  client,
  stdout: process.stdout,
  stderr: process.stderr,
  version: __HELPER_VERSION__,
});
process.exit(exitCode);

async function selectHelperClient(): Promise<HelperClient> {
  if (process.env.MYCLAUDE_FORCE_STANDALONE === "1") {
    return createInProcessHelperClient();
  }
  // Only the `anthropic` subcommand benefits from the daemon path right now;
  // mcp-headers still needs the in-process resolver because the daemon does
  // not yet render header templates. We return a hybrid that tries IPC for
  // anthropic and falls back for mcp-headers.
  try {
    const ipc = await createIpcHelperClient();
    const local = createInProcessHelperClient();
    return {
      anthropic: ipc.anthropic.bind(ipc),
      mcpHeaders: local.mcpHeaders.bind(local),
    };
  } catch {
    return createInProcessHelperClient();
  }
}

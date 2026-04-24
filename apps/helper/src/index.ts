/**
 * @module index
 *
 * Entry point for the `myclaude-helper` binary.
 *
 * This module is a thin shell: it constructs the default in-process
 * `HelperClient`, installs the SIGINT handler for exit code 130, delegates
 * to `run`, and forwards the returned exit code to `process.exit`.
 *
 * The shebang (`#!/usr/bin/env node`) is injected by tsup's `banner` option.
 * `__HELPER_VERSION__` is replaced at bundle time by tsup's `define` option.
 */
import { run } from "./cli.js";
import { createInProcessHelperClient } from "./client/in-process.js";
import { EXIT_INTERRUPTED } from "./errors.js";

/** Build-time constant injected by tsup's `define` option. */
declare const __HELPER_VERSION__: string;

process.on("SIGINT", () => {
  process.stderr.write("\n");
  process.exit(EXIT_INTERRUPTED);
});

const client = createInProcessHelperClient();
const exitCode = await run({
  argv: process.argv.slice(2),
  client,
  stdout: process.stdout,
  stderr: process.stderr,
  version: __HELPER_VERSION__,
});
process.exit(exitCode);

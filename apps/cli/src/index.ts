import { defineCommand, runMain } from "citty";
/**
 * @module index
 *
 * Entry point for the `myclaude` CLI binary.
 *
 * Wires together Citty commands, installs the SIGINT handler for exit code 130,
 * and routes `CoreError` / `CliError` subclasses to user-friendly messages.
 *
 * The shebang (`#!/usr/bin/env node`) is injected by tsup's `banner` option.
 */
import { createConsola } from "consola";
import { doctorCommand } from "./commands/doctor.js";
import { profileCommand } from "./commands/profile/index.js";
import { renderCommand } from "./commands/render.js";
import { schemaCommand } from "./commands/schema.js";
import { versionCommand } from "./commands/version.js";
import { EXIT_INTERRUPTED, mapCoreError } from "./errors.js";

/** Global consola instance (used for error output). */
const logger = createConsola({ level: 3 });

// ── SIGINT handler ────────────────────────────────────────────────────────────
process.on("SIGINT", () => {
  process.stderr.write("\n");
  process.exit(EXIT_INTERRUPTED);
});

// ── Root command ──────────────────────────────────────────────────────────────
const main = defineCommand({
  meta: {
    name: "myclaude",
    description: "Agent Profile — manage Claude Code profiles",
    version: "0.0.1",
  },
  subCommands: {
    profile: profileCommand,
    render: renderCommand,
    schema: schemaCommand,
    doctor: doctorCommand,
    version: versionCommand,
  },
});

// ── Run with global error handler ─────────────────────────────────────────────
runMain(main).catch((err: unknown) => {
  const { exitCode, message, hint } = mapCoreError(err);
  const isVerbose = process.argv.includes("--verbose") || process.argv.includes("-v");

  if (isVerbose && err instanceof Error && err.stack) {
    logger.error(err.stack);
  } else {
    logger.error(message);
  }

  if (hint) {
    logger.info(hint);
  }

  process.exit(exitCode);
});

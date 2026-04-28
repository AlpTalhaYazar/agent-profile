/**
 * @module index
 *
 * Entry point for the `myclaude` CLI binary.
 *
 * Wires together Citty commands and routes `CoreError` / `CliError`
 * subclasses to user-friendly messages.
 *
 * The shebang (`#!/usr/bin/env node`) is injected by tsup's `banner` option.
 */
import { defineCommand, runCommand, showUsage } from "citty";
import { createConsola } from "consola";
import { authCommand } from "./commands/auth/index.js";
import { daemonCommand } from "./commands/daemon/index.js";
import { doctorCommand } from "./commands/doctor.js";
import { launchCommand } from "./commands/launch/index.js";
import { profileCommand } from "./commands/profile/index.js";
import { renderCommand } from "./commands/render.js";
import { schemaCommand } from "./commands/schema.js";
import { secretsCommand } from "./commands/secrets/index.js";
import { sessionsCommand } from "./commands/sessions.js";
import { unuseCommand } from "./commands/unuse.js";
import { useCommand } from "./commands/use.js";
import { versionCommand } from "./commands/version.js";
import { mapCoreError } from "./errors.js";

/** Global consola instance (used for error output). */
const logger = createConsola({ level: 3 });

// ── Root command ──────────────────────────────────────────────────────────────
const CLI_VERSION = "0.0.1";

const main = defineCommand({
  meta: {
    name: "myclaude",
    description: "Agent Profile — manage Claude Code profiles",
    version: CLI_VERSION,
  },
  subCommands: {
    auth: authCommand,
    profile: profileCommand,
    launch: launchCommand,
    use: useCommand,
    unuse: unuseCommand,
    render: renderCommand,
    sessions: sessionsCommand,
    secrets: secretsCommand,
    schema: schemaCommand,
    daemon: daemonCommand,
    doctor: doctorCommand,
    version: versionCommand,
  },
});

// ── Run with global error handler ─────────────────────────────────────────────
//
// citty's own `runMain` always exits 1 on error, which collapses every
// documented exit code (2 config / 3 auth / 4 daemon / 5 spawn / 6 cancelled)
// to "generic error". We use `runCommand` directly so `CliError.exitCode`
// reaches `process.exit` intact.
const rawArgs = process.argv.slice(2);

try {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    await showUsage(main);
    process.exit(0);
  }
  if (rawArgs.length === 1 && rawArgs[0] === "--version") {
    process.stdout.write(`${CLI_VERSION}\n`);
    process.exit(0);
  }
  await runCommand(main, { rawArgs });
  process.exit(process.exitCode ?? 0);
} catch (err) {
  const { exitCode, message, hint } = mapCoreError(err);
  const isVerbose = rawArgs.includes("--verbose") || rawArgs.includes("-v");

  if (isVerbose && err instanceof Error && err.stack) {
    logger.error(err.stack);
  } else {
    logger.error(message);
  }

  if (hint) {
    logger.info(hint);
  }

  process.exit(exitCode);
}

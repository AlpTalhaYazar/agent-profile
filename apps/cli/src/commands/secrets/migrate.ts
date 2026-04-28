/**
 * @module commands/secrets/migrate
 *
 * `myclaude secrets migrate [--dry-run] [--keep-keyring]`
 *
 * Idempotent one-way migration from `@napi-rs/keyring` (Phase 1 standalone
 * keychain) to `safeStorage`-encrypted entries owned by the daemon. The
 * migration only makes sense when the daemon is reachable, so this command
 * forces the daemon transport (`requireDaemon`) and exits 4 otherwise.
 */

import { defineCommand } from "citty";
import { CliError, EXIT_GENERIC } from "../../errors.js";
import { getTransport } from "../../transport/index.js";

/** Options for {@link runSecretsMigrate}. */
export interface SecretsMigrateOptions {
  dryRun?: boolean;
  keepKeyring?: boolean;
  json?: boolean;
}

/** Core logic for `secrets migrate`. */
export async function runSecretsMigrate(opts: SecretsMigrateOptions): Promise<void> {
  const transport = await getTransport({ requireDaemon: true });
  try {
    const report = await transport.secretsMigrate({
      ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      ...(opts.keepKeyring !== undefined ? { keepKeyring: opts.keepKeyring } : {}),
    });
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
      if (report.errors.length > 0) {
        throw new CliError(`${report.errors.length} key(s) failed to migrate`, EXIT_GENERIC);
      }
      return;
    }
    const verb = opts.dryRun ? "Would migrate" : "Migrated";
    process.stdout.write(
      `Scanned ${report.scanned} keyring entries: ${verb} ${report.migrated}, ` +
        `skipped ${report.skipped}, errors ${report.errors.length}.\n`
    );
    for (const e of report.errors) {
      process.stderr.write(`  ! ${e.key}: ${e.reason}\n`);
    }
    if (report.errors.length > 0) {
      throw new CliError(`${report.errors.length} key(s) failed to migrate`, EXIT_GENERIC);
    }
  } finally {
    await transport.close();
  }
}

/** `myclaude secrets migrate` command definition. */
export const secretsMigrateCommand = defineCommand({
  meta: {
    name: "migrate",
    description: "Migrate keyring secrets into the daemon's safeStorage store",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Plan only — do not write to the daemon's store",
      default: false,
    },
    "keep-keyring": {
      type: "boolean",
      description: "Leave the keyring entries in place after migration (default true)",
      default: true,
    },
    json: {
      type: "boolean",
      description: "Emit a JSON report instead of human-readable output",
      default: false,
    },
  },
  async run({ args }) {
    await runSecretsMigrate({
      dryRun: args["dry-run"],
      keepKeyring: args["keep-keyring"],
      json: args.json,
    });
  },
});

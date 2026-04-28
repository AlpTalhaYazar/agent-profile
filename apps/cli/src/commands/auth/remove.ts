import type { Backend } from "@agent-profile/secrets";
import { getBackend, parseKeyringUri, removeSecret } from "@agent-profile/secrets";
/**
 * @module commands/auth/remove
 *
 * `myclaude auth remove <id> [--yes]`
 *
 * Deletes an auth profile:
 * 1. Removes the metadata entry from `authProfiles.yml`.
 * 2. Removes every keychain entry listed in `mcpSecretRefs`.
 * 3. Removes the Anthropic keychain entry.
 *
 * Confirms destructive action unless `--yes` is given.
 * If some keychain deletes fail, reports partial success and exits 1.
 * Others are still deleted.
 *
 * Exit codes:
 * - 0 on full success.
 * - 1 if some keychain deletes failed (partial removal).
 * - 3 if the profile is not found.
 * - 6 if the user declined the confirmation.
 */
import { defineCommand } from "citty";
import { loadAuthProfiles, saveAuthProfiles } from "../../auth/profiles-file.js";
import { isTTY, promptConfirm } from "../../auth/prompt-secrets.js";
import { CliError, EXIT_GENERIC, EXIT_USER_CANCELLED } from "../../errors.js";
import { getTransport } from "../../transport/index.js";

/** Exit code 3: auth failure / not found. */
const EXIT_AUTH = 3;

/**
 * Options for the `auth remove` command logic.
 */
export interface AuthRemoveOptions {
  /** The auth profile ID to remove. */
  id: string;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
  /** Exit 4 if daemon routing is required and no daemon is reachable. */
  requireDaemon?: boolean;
  /** Force standalone path; skips any daemon attempt. */
  standalone?: boolean;
  /** Injected backend (for tests). */
  backend?: Backend;
}

/**
 * Core logic for `auth remove`.
 *
 * @param opts - Remove options.
 * @throws {CliError} If the profile is not found or the user declines.
 */
export async function runAuthRemove(opts: AuthRemoveOptions): Promise<void> {
  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.home !== undefined) transportOpts.home = opts.home;
  if (opts.requireDaemon !== undefined) transportOpts.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;

  const transport = await getTransport(transportOpts);
  try {
    if (transport.transportKind === "daemon") {
      await runAuthRemoveViaDaemon(opts, transport);
      return;
    }
    await runAuthRemoveDirect(opts);
  } finally {
    await transport.close();
  }
}

async function runAuthRemoveViaDaemon(
  opts: AuthRemoveOptions,
  transport: Awaited<ReturnType<typeof getTransport>>
): Promise<void> {
  const { id, yes = false, home } = opts;

  const doc = loadAuthProfiles(home);

  const profile = doc.authProfiles[id];
  if (!profile) {
    throw new CliError(`Auth profile "${id}" not found.`, EXIT_AUTH);
  }

  if (!yes) {
    if (!isTTY()) {
      throw new CliError(
        `Non-TTY mode requires --yes to confirm removal of "${id}".`,
        EXIT_USER_CANCELLED
      );
    }
    const confirmed = await promptConfirm(
      `Remove auth profile "${id}" and all its keychain entries?`
    );
    if (!confirmed) {
      throw new CliError("Removal cancelled by user.", EXIT_USER_CANCELLED);
    }
  }

  const { failed } = await transport.authRemove({ authId: id, yes });

  if (failed.length > 0) {
    process.stderr.write(`Warning: failed to delete keychain entries for: ${failed.join(", ")}\n`);
    process.stdout.write(
      `Auth profile "${id}" metadata removed. Some keychain entries may remain.\n`
    );
    process.exit(EXIT_GENERIC);
  }

  process.stdout.write(`Auth profile "${id}" removed.\n`);
}

async function runAuthRemoveDirect(opts: AuthRemoveOptions): Promise<void> {
  const { id, yes = false, home } = opts;

  const doc = loadAuthProfiles(home);

  const profile = doc.authProfiles[id];
  if (!profile) {
    throw new CliError(`Auth profile "${id}" not found.`, EXIT_AUTH);
  }

  if (!yes) {
    if (!isTTY()) {
      throw new CliError(
        `Non-TTY mode requires --yes to confirm removal of "${id}".`,
        EXIT_USER_CANCELLED
      );
    }
    const confirmed = await promptConfirm(
      `Remove auth profile "${id}" and all its keychain entries?`
    );
    if (!confirmed) {
      throw new CliError("Removal cancelled by user.", EXIT_USER_CANCELLED);
    }
  }

  const backend = opts.backend ?? (await getBackend());

  const entries: Array<{ service: string; account: string; name: string }> = [];

  try {
    const parsed = parseKeyringUri(profile.anthropic.secretRef);
    entries.push({ ...parsed, name: "anthropic" });
  } catch {
    // Invalid URI — skip.
  }

  for (const [secretName, ref] of Object.entries(profile.mcpSecretRefs)) {
    try {
      const parsed = parseKeyringUri(ref);
      entries.push({ ...parsed, name: secretName });
    } catch {
      // Invalid URI — skip.
    }
  }

  const failed: string[] = [];
  for (const entry of entries) {
    try {
      await removeSecret(entry.service, entry.account, backend);
    } catch {
      failed.push(entry.name);
    }
  }

  delete doc.authProfiles[id];
  saveAuthProfiles(doc, home);

  if (failed.length > 0) {
    process.stderr.write(`Warning: failed to delete keychain entries for: ${failed.join(", ")}\n`);
    process.stdout.write(
      `Auth profile "${id}" metadata removed. Some keychain entries may remain.\n`
    );
    process.exit(EXIT_GENERIC);
  }

  process.stdout.write(`Auth profile "${id}" removed.\n`);
}

/**
 * `myclaude auth remove <id>` command definition.
 */
export const authRemoveCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Delete an auth profile and its keychain entries",
  },
  args: {
    id: {
      type: "positional",
      description: "Auth profile ID",
      required: true,
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
  },
  async run({ args }) {
    await runAuthRemove({
      id: args.id,
      yes: args.yes,
      home: args.home,
    });
  },
});

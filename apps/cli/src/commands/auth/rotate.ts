import type { Backend } from "@agent-profile/secrets";
import { getBackend, parseKeyringUri, setSecret } from "@agent-profile/secrets";
/**
 * @module commands/auth/rotate
 *
 * `myclaude auth rotate <id>`
 *
 * Rotates the Anthropic secret for an existing auth profile.
 * Prompts for the new secret (or reads from stdin with `--stdin`).
 * Metadata in `authProfiles.yml` is unchanged.
 *
 * Exit codes:
 * - 3 if the auth profile ID is not found.
 */
import { defineCommand } from "citty";
import { loadAuthProfiles } from "../../auth/profiles-file.js";
import { isTTY, promptSecret, readStdin } from "../../auth/prompt-secrets.js";
import { CliError, EXIT_GENERIC } from "../../errors.js";
import { getTransport } from "../../transport/index.js";

/** Exit code 3: auth failure / not found. */
const EXIT_AUTH = 3;

/**
 * Options for the `auth rotate` command logic.
 */
export interface AuthRotateOptions {
  /** The auth profile ID to rotate. */
  id: string;
  /** Read the new secret from stdin. */
  stdin?: boolean;
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
 * Core logic for `auth rotate`.
 *
 * @param opts - Rotate options.
 * @throws {CliError} If the profile is not found.
 */
export async function runAuthRotate(opts: AuthRotateOptions): Promise<void> {
  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.home !== undefined) transportOpts.home = opts.home;
  if (opts.requireDaemon !== undefined) transportOpts.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;

  const transport = await getTransport(transportOpts);
  try {
    if (transport.transportKind === "daemon") {
      await runAuthRotateViaDaemon(opts, transport);
      return;
    }
    await runAuthRotateDirect(opts);
  } finally {
    await transport.close();
  }
}

async function runAuthRotateViaDaemon(
  opts: AuthRotateOptions,
  transport: Awaited<ReturnType<typeof getTransport>>
): Promise<void> {
  const { id, stdin = false, home } = opts;

  const doc = loadAuthProfiles(home);

  const profile = doc.authProfiles[id];
  if (!profile) {
    throw new CliError(
      `Auth profile "${id}" not found. Create it first with: myclaude auth add ${id}`,
      EXIT_AUTH
    );
  }

  let secretValue: string;
  if (stdin) {
    secretValue = await readStdin();
  } else if (isTTY()) {
    secretValue = await promptSecret(`New Anthropic secret for "${id}":`);
  } else {
    throw new CliError("Non-TTY mode requires --stdin to provide the new secret.", EXIT_GENERIC);
  }

  try {
    await transport.authRotate({ authId: id, anthropicSecret: secretValue });
  } finally {
    secretValue = "";
  }

  process.stdout.write(`Anthropic secret for "${id}" rotated.\n`);
}

async function runAuthRotateDirect(opts: AuthRotateOptions): Promise<void> {
  const { id, stdin = false, home } = opts;

  const doc = loadAuthProfiles(home);

  const profile = doc.authProfiles[id];
  if (!profile) {
    throw new CliError(
      `Auth profile "${id}" not found. Create it first with: myclaude auth add ${id}`,
      EXIT_AUTH
    );
  }

  const backend = opts.backend ?? (await getBackend());
  if (backend.kind === "basic-text" && process.env.MYCLAUDE_ALLOW_PLAINTEXT !== "1") {
    throw new CliError(
      "Linux secret service unavailable (basic-text backend detected).\n" +
        "Refusing to persist secrets unencrypted.\n" +
        "Fix:\n" +
        "  Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring\n" +
        "  Fedora:         sudo dnf install libsecret\n" +
        "  Arch:           sudo pacman -S libsecret\n\n" +
        "Or set MYCLAUDE_ALLOW_PLAINTEXT=1 if this is a disposable CI container.",
      EXIT_AUTH
    );
  }

  let secretValue: string;
  if (stdin) {
    secretValue = await readStdin();
  } else if (isTTY()) {
    secretValue = await promptSecret(`New Anthropic secret for "${id}":`);
  } else {
    throw new CliError("Non-TTY mode requires --stdin to provide the new secret.", EXIT_GENERIC);
  }

  const { service, account } = parseKeyringUri(profile.anthropic.secretRef);
  try {
    await setSecret(service, account, secretValue, backend);
  } finally {
    secretValue = "";
  }

  process.stdout.write(`Anthropic secret for "${id}" rotated.\n`);
}

/**
 * `myclaude auth rotate <id>` command definition.
 */
export const authRotateCommand = defineCommand({
  meta: {
    name: "rotate",
    description: "Rotate the Anthropic secret for an auth profile",
  },
  args: {
    id: {
      type: "positional",
      description: "Auth profile ID",
      required: true,
    },
    stdin: {
      type: "boolean",
      description: "Read new secret from stdin",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
  },
  async run({ args }) {
    await runAuthRotate({
      id: args.id,
      stdin: args.stdin,
      home: args.home,
    });
  },
});

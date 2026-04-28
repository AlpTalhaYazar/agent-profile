import type { Backend } from "@agent-profile/secrets";
import { getBackend, parseKeyringUri, setSecret } from "@agent-profile/secrets";
/**
 * @module commands/auth/set
 *
 * `myclaude auth set <id> <name> [value]`
 *
 * Sets or replaces a single MCP secret for an existing auth profile.
 *
 * - Without `<value>`, prompts interactively.
 * - With `--stdin`, reads the value from stdin.
 * - `--register` adds the name to `mcpSecretRefs` if it doesn't exist yet.
 *
 * Exit codes:
 * - 3 if the auth profile ID is not found.
 * - 3 if the secret name is not registered and `--register` is not given.
 */
import { defineCommand } from "citty";
import { loadAuthProfiles, saveAuthProfiles } from "../../auth/profiles-file.js";
import { isTTY, promptSecret, readStdin } from "../../auth/prompt-secrets.js";
import { CliError, EXIT_GENERIC } from "../../errors.js";
import { getTransport } from "../../transport/index.js";

/** Exit code 3: auth failure / not found. */
const EXIT_AUTH = 3;

/**
 * Options for the `auth set` command logic.
 */
export interface AuthSetOptions {
  /** The auth profile ID. */
  id: string;
  /** The secret name (key in `mcpSecretRefs`). */
  name: string;
  /** The secret value. If omitted and not `stdin`, prompts interactively. */
  value?: string;
  /** Read the value from stdin. */
  stdin?: boolean;
  /** Register the name in `mcpSecretRefs` if it doesn't already exist. */
  register?: boolean;
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
 * Core logic for `auth set`.
 *
 * @param opts - Set options.
 * @throws {CliError} If the profile or secret name is not found.
 */
export async function runAuthSet(opts: AuthSetOptions): Promise<void> {
  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.home !== undefined) transportOpts.home = opts.home;
  if (opts.requireDaemon !== undefined) transportOpts.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;

  const transport = await getTransport(transportOpts);
  try {
    if (transport.transportKind === "daemon") {
      await runAuthSetViaDaemon(opts, transport);
      return;
    }
    await runAuthSetDirect(opts);
  } finally {
    await transport.close();
  }
}

async function runAuthSetViaDaemon(
  opts: AuthSetOptions,
  transport: Awaited<ReturnType<typeof getTransport>>
): Promise<void> {
  const { id, name, stdin = false, register = false, home } = opts;

  const doc = loadAuthProfiles(home);

  // Profile must exist.
  const profile = doc.authProfiles[id];
  if (!profile) {
    throw new CliError(
      `Auth profile "${id}" not found. Create it first with: myclaude auth add ${id}`,
      EXIT_AUTH
    );
  }

  // Secret name must be registered unless --register is given.
  const existingRef = profile.mcpSecretRefs[name];
  if (!existingRef && !register) {
    const available = Object.keys(profile.mcpSecretRefs);
    const hint =
      available.length > 0
        ? `Available: ${available.join(", ")}. Add --register to create a new entry.`
        : "No secrets registered yet. Use --register to add one.";
    throw new CliError(
      `Secret "${name}" not in authProfiles.${id}.mcpSecretRefs. ${hint}`,
      EXIT_AUTH
    );
  }

  let secretValue: string;
  if (opts.value !== undefined) {
    secretValue = opts.value;
  } else if (stdin) {
    secretValue = await readStdin();
  } else if (isTTY()) {
    secretValue = await promptSecret(`Value for ${id}.${name}:`);
  } else {
    throw new CliError("Non-TTY mode requires a value argument or --stdin.", EXIT_GENERIC);
  }

  try {
    await transport.authSetSecret({
      authId: id,
      name,
      value: secretValue,
      register,
    });
  } finally {
    secretValue = "";
  }

  process.stdout.write(`Secret "${id}.${name}" updated.\n`);
}

async function runAuthSetDirect(opts: AuthSetOptions): Promise<void> {
  const { id, name, stdin = false, register = false, home } = opts;

  const doc = loadAuthProfiles(home);

  const profile = doc.authProfiles[id];
  if (!profile) {
    throw new CliError(
      `Auth profile "${id}" not found. Create it first with: myclaude auth add ${id}`,
      EXIT_AUTH
    );
  }

  const existingRef = profile.mcpSecretRefs[name];
  if (!existingRef && !register) {
    const available = Object.keys(profile.mcpSecretRefs);
    const hint =
      available.length > 0
        ? `Available: ${available.join(", ")}. Add --register to create a new entry.`
        : "No secrets registered yet. Use --register to add one.";
    throw new CliError(
      `Secret "${name}" not in authProfiles.${id}.mcpSecretRefs. ${hint}`,
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
  if (opts.value !== undefined) {
    secretValue = opts.value;
  } else if (stdin) {
    secretValue = await readStdin();
  } else if (isTTY()) {
    secretValue = await promptSecret(`Value for ${id}.${name}:`);
  } else {
    throw new CliError("Non-TTY mode requires a value argument or --stdin.", EXIT_GENERIC);
  }

  const keyringUri = existingRef ?? `keyring://${name.replace(/\./g, "-")}/${id}`;
  const { service, account } = parseKeyringUri(keyringUri);

  try {
    await setSecret(service, account, secretValue, backend);
  } finally {
    secretValue = "";
  }

  if (!existingRef) {
    profile.mcpSecretRefs[name] = keyringUri;
    saveAuthProfiles(doc, home);
  }

  process.stdout.write(`Secret "${id}.${name}" updated.\n`);
}

/**
 * `myclaude auth set <id> <name> [value]` command definition.
 */
export const authSetCommand = defineCommand({
  meta: {
    name: "set",
    description: "Set or update a single MCP secret for an auth profile",
  },
  args: {
    id: {
      type: "positional",
      description: "Auth profile ID",
      required: true,
    },
    name: {
      type: "positional",
      description: "Secret name (key in mcpSecretRefs)",
      required: true,
    },
    value: {
      type: "positional",
      description: "Secret value (omit to prompt)",
      required: false,
    },
    stdin: {
      type: "boolean",
      description: "Read secret from stdin",
      default: false,
    },
    register: {
      type: "boolean",
      description: "Register a new secret name if it does not exist",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
  },
  async run({ args }) {
    await runAuthSet({
      id: args.id,
      name: args.name,
      value: args.value,
      stdin: args.stdin,
      register: args.register,
      home: args.home,
    });
  },
});

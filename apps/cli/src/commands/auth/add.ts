import type { Backend } from "@agent-profile/secrets";
import { getBackend, parseKeyringUri, setSecret } from "@agent-profile/secrets";
import { BackendUnsafeError } from "@agent-profile/secrets";
/**
 * @module commands/auth/add
 *
 * `myclaude auth add <id> [flags]`
 *
 * Creates a new auth profile:
 * 1. Prompts for (or accepts via flags) display name, Anthropic mode + secret.
 * 2. Writes metadata to `authProfiles.yml`.
 * 3. Writes the Anthropic secret to the keychain via `@agent-profile/secrets`.
 *
 * Scriptable form:
 * ```
 * myclaude auth add work \
 *   --display "Work (Acme Inc.)" \
 *   --anthropic-mode apiKey \
 *   --anthropic-secret "$ANTHROPIC_KEY"
 * ```
 *
 * Piped secret form:
 * ```
 * echo -n "$ANTHROPIC_KEY" | myclaude auth add work --anthropic-mode apiKey --stdin
 * ```
 */
import { defineCommand } from "citty";
import { loadAuthProfiles, saveAuthProfiles } from "../../auth/profiles-file.js";
import {
  isTTY,
  promptAnthropicMode,
  promptDisplayName,
  promptSecret,
  readStdin,
} from "../../auth/prompt-secrets.js";
import { CliError, EXIT_CONFIG_INVALID, EXIT_GENERIC } from "../../errors.js";

/** Valid auth profile ID pattern. */
const ID_RE = /^[a-z0-9_\-]+$/;

/**
 * Derives the keyring URI for an Anthropic secret from a profile ID.
 * Format: `keyring://anthropic/<id>`.
 *
 * @param profileId - The auth profile ID.
 */
export function anthropicKeyringUri(profileId: string): string {
  return `keyring://anthropic/${profileId}`;
}

/**
 * Options for the `auth add` command logic.
 */
export interface AuthAddOptions {
  /** The profile ID to create. */
  id: string;
  /** Display name (skips prompt if provided). */
  display?: string;
  /** Anthropic mode (skips prompt if provided). */
  anthropicMode?: "apiKey" | "bedrock" | "vertex" | "gateway";
  /** Anthropic secret value (skips prompt and stdin). */
  anthropicSecret?: string;
  /** Read secret from stdin instead of prompting. */
  stdin?: boolean;
  /** Overwrite an existing profile with the same ID. */
  force?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
  /** Injected backend (for tests). If omitted, uses `getBackend()`. */
  backend?: Backend;
}

/**
 * Core logic for `auth add`.
 *
 * @param opts - Add options.
 * @throws {CliError} On validation or write errors.
 */
export async function runAuthAdd(opts: AuthAddOptions): Promise<void> {
  const { id, force = false, stdin = false, home } = opts;

  // Validate the ID format.
  if (!ID_RE.test(id)) {
    throw new CliError(
      `Invalid auth profile ID "${id}". IDs must match [a-z0-9_-].`,
      EXIT_CONFIG_INVALID
    );
  }

  const doc = loadAuthProfiles(home);

  // Check for existing ID.
  if (doc.authProfiles[id] !== undefined && !force) {
    throw new CliError(
      `Auth profile "${id}" already exists. Use --force to overwrite.`,
      EXIT_GENERIC
    );
  }

  // Resolve backend — fail closed if unsafe.
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
      3 // EXIT_AUTH_FAILURE
    );
  }

  // --- Collect inputs (prompt if needed) ---

  let displayName: string;
  if (opts.display !== undefined) {
    displayName = opts.display;
  } else if (isTTY()) {
    displayName = await promptDisplayName();
  } else {
    displayName = id; // default to ID in non-TTY mode
  }

  let anthropicMode: "apiKey" | "bedrock" | "vertex" | "gateway";
  if (opts.anthropicMode !== undefined) {
    anthropicMode = opts.anthropicMode;
  } else if (isTTY()) {
    anthropicMode = await promptAnthropicMode();
  } else {
    throw new CliError(
      "Non-TTY mode requires --anthropic-mode (e.g. --anthropic-mode apiKey).",
      EXIT_GENERIC
    );
  }

  let secretValue: string;
  if (opts.anthropicSecret !== undefined) {
    secretValue = opts.anthropicSecret;
  } else if (stdin) {
    secretValue = await readStdin();
  } else if (isTTY()) {
    secretValue = await promptSecret("Anthropic secret:");
  } else {
    throw new CliError(
      "Non-TTY mode requires --anthropic-secret <value> or --stdin.",
      EXIT_GENERIC
    );
  }

  // Write secret to keychain.
  const secretRef = anthropicKeyringUri(id);
  const { service, account } = parseKeyringUri(secretRef);
  try {
    await setSecret(service, account, secretValue, backend);
  } finally {
    // Zero out the secret value after use.
    secretValue = "";
  }

  // Update metadata in authProfiles.yml.
  doc.authProfiles[id] = {
    displayName: displayName || undefined,
    anthropic: {
      mode: anthropicMode,
      secretRef,
    },
    mcpSecretRefs: {},
  };

  saveAuthProfiles(doc, home);

  process.stdout.write(`Auth profile "${id}" created.\n`);
}

/**
 * `myclaude auth add <id>` command definition.
 */
export const authAddCommand = defineCommand({
  meta: {
    name: "add",
    description: "Create a new auth profile",
  },
  args: {
    id: {
      type: "positional",
      description: "Auth profile ID (e.g. work, personal)",
      required: true,
    },
    display: {
      type: "string",
      description: "Display name",
    },
    "anthropic-mode": {
      type: "string",
      description: "Anthropic mode: apiKey | bedrock | vertex | gateway",
    },
    "anthropic-secret": {
      type: "string",
      description: "Anthropic secret value (prefer --stdin for scripts)",
    },
    stdin: {
      type: "boolean",
      description: "Read secret from stdin",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Overwrite existing profile with the same ID",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
  },
  async run({ args }) {
    const validModes = ["apiKey", "bedrock", "vertex", "gateway"] as const;
    type Mode = (typeof validModes)[number];
    const modeArg = args["anthropic-mode"];
    const mode: Mode | undefined =
      modeArg && (validModes as readonly string[]).includes(modeArg)
        ? (modeArg as Mode)
        : undefined;

    const addOpts: AuthAddOptions = {
      id: args.id,
      stdin: args.stdin,
      force: args.force,
    };
    if (args.display !== undefined) addOpts.display = args.display;
    if (mode !== undefined) addOpts.anthropicMode = mode;
    if (args["anthropic-secret"] !== undefined) addOpts.anthropicSecret = args["anthropic-secret"];
    if (args.home !== undefined) addOpts.home = args.home;

    await runAuthAdd(addOpts);
  },
});

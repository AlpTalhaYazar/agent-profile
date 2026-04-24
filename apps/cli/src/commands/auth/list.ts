/**
 * @module commands/auth/list
 *
 * `myclaude auth list [--show-refs] [--json]`
 *
 * Lists all auth profiles. Never prints secret values.
 * `--show-refs` prints the `keyring://` URIs (no actual secret material).
 */
import { defineCommand } from "citty";
import { loadAuthProfiles } from "../../auth/profiles-file.js";
import { formatAuthList } from "../../output/format.js";
import { writeJson } from "../../output/json.js";

/**
 * Options for the `auth list` command logic.
 */
export interface AuthListOptions {
  /** Include keyring URIs in output. No secret values are shown. */
  showRefs?: boolean;
  /** Emit structured JSON. */
  json?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
}

/**
 * Core logic for `auth list`. Returns immediately — no keychain access needed.
 *
 * @param opts - List options.
 */
export function runAuthList(opts: AuthListOptions = {}): void {
  const { showRefs = false, json = false, home } = opts;

  const doc = loadAuthProfiles(home);

  if (json) {
    const entries = Object.entries(doc.authProfiles)
      .filter(
        (entry): entry is [string, NonNullable<(typeof doc.authProfiles)[string]>] =>
          entry[1] !== undefined
      )
      .map(([id, p]) => ({
        id,
        displayName: p.displayName ?? null,
        mode: p.anthropic.mode,
        anthropicRef: showRefs ? p.anthropic.secretRef : undefined,
        mcpSecrets: showRefs ? p.mcpSecretRefs : Object.keys(p.mcpSecretRefs),
      }));
    writeJson({ authProfiles: entries });
    return;
  }

  const formatted = formatAuthList(doc.authProfiles, showRefs);
  process.stdout.write(`${formatted}\n`);
}

/**
 * `myclaude auth list` command definition.
 */
export const authListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List auth profiles (no secret values shown)",
  },
  args: {
    "show-refs": {
      type: "boolean",
      description: "Show keyring:// URIs for each secret (no values)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON",
      alias: "j",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
  },
  run({ args }) {
    runAuthList({
      showRefs: args["show-refs"],
      json: args.json,
      home: args.home,
    });
  },
});

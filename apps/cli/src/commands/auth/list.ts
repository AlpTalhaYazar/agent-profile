/**
 * @module commands/auth/list
 *
 * `myclaude auth list [--show-refs] [--json] [--require-daemon] [--standalone]`
 *
 * Lists all auth profiles. Never prints secret values.
 * `--show-refs` prints the `keyring://` URIs (no actual secret material).
 *
 * Data load goes through `getTransport`, which prefers the daemon when one is
 * running and falls back to in-process services otherwise. The human-readable
 * formatter still uses the YAML doc directly for the standalone path so it
 * has access to the full `mcpSecretRefs` map (the daemon's projection drops
 * URIs unless `--show-refs` is set, which would lose information when the
 * formatter wants to render both names and URIs together).
 */
import { loadAuthProfiles } from "@agent-profile/cli-services";
import { defineCommand } from "citty";
import { formatAuthList } from "../../output/format.js";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";
import type { TransportAuthProfile } from "../../transport/types.js";

/**
 * Options for the `auth list` command logic.
 */
export interface AuthListOptions {
  /** Include keyring URIs in output. No secret values are shown. */
  showRefs?: boolean;
  /** Emit structured JSON. */
  json?: boolean;
  /** Pretty-print JSON output (implies json). */
  pretty?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
  /** Exit 4 if the daemon is unreachable instead of falling back to standalone. */
  requireDaemon?: boolean;
  /** Force standalone path; skip the daemon attempt entirely. */
  standalone?: boolean;
}

/**
 * Core logic for `auth list`.
 *
 * Routes through `getTransport`. When the daemon is reachable and the user
 * asked for human output, we still use the YAML-backed formatter for parity
 * with Phase 1; the daemon's projection is sufficient for JSON.
 *
 * @param opts - List options.
 */
export async function runAuthList(opts: AuthListOptions = {}): Promise<void> {
  const { showRefs = false, home, pretty = false } = opts;
  const json = Boolean(opts.json) || pretty;

  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (home !== undefined) transportOpts.home = home;
  if (opts.requireDaemon !== undefined) transportOpts.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;
  const transport = await getTransport(transportOpts);

  try {
    if (json) {
      const listInput: Parameters<typeof transport.authList>[0] = { includeRefs: showRefs };
      if (home !== undefined) listInput.home = home;
      const { profiles } = await transport.authList(listInput);
      const entries = profiles.map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        mode: profile.mode,
        anthropicRef: showRefs ? profile.anthropicRef : undefined,
        mcpSecrets: showRefs ? profile.refs : profile.secrets,
      }));
      writeJson({ authProfiles: entries }, pretty);
      return;
    }

    if (transport.transportKind === "daemon") {
      // Daemon path: format the projection directly. We can't reach the YAML
      // doc through the transport, and the daemon would need to ship URIs to
      // produce identical output to the YAML-backed formatter.
      const listInput: Parameters<typeof transport.authList>[0] = { includeRefs: showRefs };
      if (home !== undefined) listInput.home = home;
      const { profiles } = await transport.authList(listInput);
      process.stdout.write(`${formatAuthListProjection(profiles, showRefs)}\n`);
      return;
    }

    // Standalone: keep the existing formatter so Phase 1 output is byte-identical.
    const doc = loadAuthProfiles(home);
    const formatted = formatAuthList(doc.authProfiles, showRefs);
    process.stdout.write(`${formatted}\n`);
  } finally {
    await transport.close();
  }
}

/**
 * Mirror the YAML-backed formatter using the daemon's projected wire shape.
 * Keeps the columns and ordering aligned with `formatAuthList` so the human
 * output looks the same regardless of transport.
 */
function formatAuthListProjection(profiles: TransportAuthProfile[], showRefs: boolean): string {
  if (profiles.length === 0) {
    return "No auth profiles configured.\n\nAdd one with: myclaude auth add <id>";
  }
  const lines: string[] = [];
  lines.push(`${"ID".padEnd(16)}${"DISPLAY NAME".padEnd(24)}${"MODE".padEnd(12)}SECRETS`);
  for (const profile of profiles) {
    const displayName = profile.displayName ?? "(no name)";
    const secrets = profile.secrets;
    const secretsDisplay = secrets.length > 0 ? secrets.join(", ") : "(none)";
    lines.push(
      `${profile.id.padEnd(16)}${displayName.padEnd(24)}${profile.mode.padEnd(12)}${secretsDisplay}`
    );
    if (showRefs && profile.anthropicRef) {
      lines.push(`  anthropic: ${profile.anthropicRef}`);
    }
    if (showRefs && profile.refs) {
      for (const [secretName, ref] of Object.entries(profile.refs)) {
        lines.push(`  ${secretName}: ${ref}`);
      }
    }
  }
  return lines.join("\n");
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
      description: "Emit structured JSON to stdout",
      alias: "j",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty-print JSON output (implies --json)",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
    "require-daemon": {
      type: "boolean",
      description: "Exit 4 if the daemon is unreachable",
      default: false,
    },
    standalone: {
      type: "boolean",
      description: "Skip the daemon attempt; always run in-process",
      default: false,
    },
  },
  async run({ args }) {
    await runAuthList({
      showRefs: args["show-refs"],
      json: args.json,
      pretty: args.pretty,
      home: args.home,
      requireDaemon: Boolean(args["require-daemon"]),
      standalone: Boolean(args.standalone),
    });
  },
});

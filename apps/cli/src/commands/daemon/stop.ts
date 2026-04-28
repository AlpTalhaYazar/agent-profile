/**
 * @module commands/daemon/stop
 *
 * `myclaude daemon stop [--force] [--json]`
 *
 * Sends a `daemon.stop` request and prints `Daemon: stopped`. Exits 4 if the
 * daemon was already gone.
 */
import { defineCommand } from "citty";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";

/** Options for the `daemon stop` command logic. */
export interface DaemonStopOptions {
  /** Skip the in-flight drain window — daemon SIGTERMs active sessions. */
  force?: boolean;
  /** Emit structured JSON. */
  json?: boolean;
  /** Pretty-print JSON output (implies json). */
  pretty?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
}

/**
 * Core logic for `daemon stop`. Throws `CliError(EXIT_DAEMON_UNREACHABLE)` if
 * the daemon cannot be reached.
 */
export async function runDaemonStop(opts: DaemonStopOptions = {}): Promise<void> {
  const pretty = Boolean(opts.pretty);
  const json = Boolean(opts.json) || pretty;

  const getTransportOpts: Parameters<typeof getTransport>[0] = { requireDaemon: true };
  if (opts.home !== undefined) getTransportOpts.home = opts.home;
  const transport = await getTransport(getTransportOpts);
  try {
    const stopInput: { force?: boolean } = {};
    if (opts.force !== undefined) stopInput.force = opts.force;
    await transport.daemonStop(stopInput);
    if (json) {
      writeJson({ stopped: true, force: Boolean(opts.force) }, pretty);
      return;
    }
    process.stdout.write("Daemon: stopped\n");
  } finally {
    await transport.close();
  }
}

/** `myclaude daemon stop` command definition. */
export const daemonStopCommand = defineCommand({
  meta: {
    name: "stop",
    description: "Stop the daemon gracefully (use --force to SIGTERM active sessions)",
  },
  args: {
    force: {
      type: "boolean",
      description: "Skip the drain window and SIGTERM active sessions",
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
  },
  async run({ args }) {
    await runDaemonStop({
      force: Boolean(args.force),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    });
  },
});

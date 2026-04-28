/**
 * @module commands/daemon/status
 *
 * `myclaude daemon status [--json] [--pretty]`
 *
 * Reports daemon liveness, socket path, uptime, and session counts. Exits 4
 * if the daemon is unreachable.
 */
import { defineCommand } from "citty";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";
import type { TransportDaemonStatusResult } from "../../transport/types.js";

/** Options for the `daemon status` command logic. */
export interface DaemonStatusOptions {
  /** Emit structured JSON. */
  json?: boolean;
  /** Pretty-print JSON output (implies json). */
  pretty?: boolean;
  /** Override myclaude home directory (for tests). */
  home?: string;
}

/**
 * Core logic for `daemon status`. Always uses `requireDaemon: true`, so the
 * function exits non-zero (via thrown CliError) if the daemon cannot be reached.
 */
export async function runDaemonStatus(opts: DaemonStatusOptions = {}): Promise<void> {
  const pretty = Boolean(opts.pretty);
  const json = Boolean(opts.json) || pretty;

  const getTransportOpts: Parameters<typeof getTransport>[0] = { requireDaemon: true };
  if (opts.home !== undefined) getTransportOpts.home = opts.home;
  const transport = await getTransport(getTransportOpts);
  try {
    const status = await transport.daemonStatus();
    if (json) {
      writeJson(status, pretty);
      return;
    }
    process.stdout.write(`${formatStatus(status)}\n`);
  } finally {
    await transport.close();
  }
}

/** Render the human-readable status table. */
function formatStatus(status: TransportDaemonStatusResult): string {
  const lines = [
    `Daemon:    running (pid ${status.pid})`,
    `Socket:    ${status.socketPath}`,
    `Uptime:    ${formatUptime(status.uptimeMs)}`,
    `Sessions:  ${status.sessionCounts.active} active, ${status.sessionCounts.total} recent`,
  ];
  return lines.join("\n");
}

/** Format an uptime millisecond value as `1d 2h 3m` / `4h 5m` / `6m 7s` / `8s`. */
function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** `myclaude daemon status` command definition. */
export const daemonStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show daemon liveness, socket path, uptime, and session counts",
  },
  args: {
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
    await runDaemonStatus({
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    });
  },
});

import { defineCommand } from "citty";
import { writeJson } from "../../output/json.js";
import type { SessionRecord } from "../../session/registry.js";
import { getTransport } from "../../transport/index.js";
import { streamSessionsEvents } from "./events.js";
import { formatSessionList } from "./format.js";
import type { TransportSelectionOptions } from "./shared.js";
import { buildTransportOptions, isJsonMode, resolveSessionsRoot } from "./shared.js";
import type { SessionsListOptions } from "./types.js";

/** List active and recent sessions from the registry. */
export async function runSessionsList(opts: SessionsListOptions = {}): Promise<SessionRecord[]> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const followMode = Boolean(opts.follow);

  const transportSelection: TransportSelectionOptions = {};
  if (opts.home !== undefined) transportSelection.home = opts.home;
  if (followMode) {
    transportSelection.requireDaemon = true;
  } else if (opts.requireDaemon !== undefined) {
    transportSelection.requireDaemon = opts.requireDaemon;
  }
  if (opts.standalone !== undefined) transportSelection.standalone = opts.standalone;
  const transportOpts = buildTransportOptions(transportSelection);
  const transport = await getTransport(transportOpts);

  let records: SessionRecord[];
  try {
    records = await transport.sessionsList({
      sessionsRoot,
      activeOnly: Boolean(opts.active),
    });

    const jsonMode = isJsonMode(opts);
    if (jsonMode) {
      writeJson({ sessions: records }, Boolean(opts.pretty));
    } else {
      process.stdout.write(`${formatSessionList(records, opts.nowMs ?? Date.now())}\n`);
    }

    if (followMode) {
      await streamSessionsEvents(transport, jsonMode);
    }
  } finally {
    await transport.close();
  }

  return records;
}

export const sessionsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List active and recent sessions from the file-backed registry",
  },
  args: {
    active: {
      type: "boolean",
      description: "Show only running sessions",
      default: false,
    },
    all: {
      type: "boolean",
      description: "Include all file-backed history",
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
    follow: {
      type: "boolean",
      description: "Stream session events from the daemon until SIGINT",
      alias: "f",
      default: false,
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
    await runSessionsList({
      active: Boolean(args.active),
      all: Boolean(args.all),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
      follow: Boolean(args.follow),
      requireDaemon: Boolean(args["require-daemon"]),
      standalone: Boolean(args.standalone),
    });
  },
});

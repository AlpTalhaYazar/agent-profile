import { defineCommand } from "citty";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";
import { myClaudeHome } from "../../utils/paths.js";
import type { TransportSelectionOptions } from "./shared.js";
import {
  buildTransportOptions,
  isJsonMode,
  requireSessionId,
  resolveSessionsRoot,
} from "./shared.js";
import type { SessionsDriftOptions } from "./types.js";

/** Recompute and compare the launch hash for a session. */
export async function runSessionsDrift(opts: SessionsDriftOptions): Promise<{
  drifted: boolean;
  scopesChanged: string[];
  oldHash: string;
  newHash: string;
}> {
  const sessionId = requireSessionId(opts.sessionId);
  const sessionsRoot = resolveSessionsRoot(opts);
  const home = opts.home ?? myClaudeHome();
  const jsonMode = isJsonMode(opts);
  const transportSelection: TransportSelectionOptions = {};
  if (opts.requireDaemon !== undefined) transportSelection.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportSelection.standalone = opts.standalone;
  const transport = await getTransport(buildTransportOptions(transportSelection));

  try {
    const result = await transport.sessionsDrift({
      sessionsRoot,
      sessionId,
      home,
    });
    if (jsonMode) {
      writeJson(result, Boolean(opts.pretty));
    } else {
      const flag = result.drifted ? "DRIFTED" : "in sync";
      process.stdout.write(`Session ${sessionId}: ${flag}\n`);
      process.stdout.write(`  oldHash:  ${result.oldHash}\n`);
      process.stdout.write(`  newHash:  ${result.newHash}\n`);
      if (result.scopesChanged.length > 0) {
        process.stdout.write("  scopes changed:\n");
        for (const scope of result.scopesChanged) {
          process.stdout.write(`    ${scope}\n`);
        }
      }
    }
    return result;
  } finally {
    await transport.close();
  }
}

export const sessionsDriftCommand = defineCommand({
  meta: {
    name: "drift",
    description: "Recompute the launch hash and report drift",
  },
  args: {
    sessionId: {
      type: "positional",
      description: "Session ID",
      required: true,
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
    standalone: {
      type: "boolean",
      description: "Skip the daemon attempt; always run in-process",
      default: false,
    },
  },
  async run({ args }) {
    await runSessionsDrift({
      sessionId: String(requireSessionId(args.sessionId ? String(args.sessionId) : undefined)),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
      standalone: Boolean(args.standalone),
    });
  },
});

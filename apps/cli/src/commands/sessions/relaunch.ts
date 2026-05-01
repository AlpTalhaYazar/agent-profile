import { defineCommand } from "citty";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";
import { isJsonMode, requireSessionId } from "./shared.js";
import type { SessionsRelaunchOptions } from "./types.js";

/** Spawn a fresh session with the same role/auth/cwd as an existing one. */
export async function runSessionsRelaunch(opts: SessionsRelaunchOptions): Promise<{
  sessionId: string;
  relaunchedFrom: string;
}> {
  const sessionId = requireSessionId(opts.sessionId);
  const jsonMode = isJsonMode(opts);
  const transport = await getTransport({ requireDaemon: true });
  try {
    const result = await transport.sessionsRelaunch({ sessionId });
    if (jsonMode) {
      writeJson(
        { sessionId: result.sessionId, relaunchedFrom: result.relaunchedFrom },
        Boolean(opts.pretty)
      );
    } else {
      process.stdout.write(`Relaunched ${result.relaunchedFrom} as ${result.sessionId}.\n`);
    }
    return { sessionId: result.sessionId, relaunchedFrom: result.relaunchedFrom };
  } finally {
    await transport.close();
  }
}

export const sessionsRelaunchCommand = defineCommand({
  meta: {
    name: "relaunch",
    description: "Spawn a fresh session with the same role/auth/cwd",
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
  },
  async run({ args }) {
    await runSessionsRelaunch({
      sessionId: String(requireSessionId(args.sessionId ? String(args.sessionId) : undefined)),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    });
  },
});

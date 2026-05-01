import { defineCommand } from "citty";
import { writeJson } from "../../output/json.js";
import type { SessionRecord } from "../../session/registry.js";
import { readSessionRecord } from "../../session/registry.js";
import { formatSessionShow } from "./format.js";
import { isJsonMode, requireSessionId, resolveSessionsRoot } from "./shared.js";
import type { SessionsShowOptions } from "./types.js";

/** Show one session record in detail. */
export async function runSessionsShow(opts: SessionsShowOptions): Promise<SessionRecord> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const record = await readSessionRecord({
    sessionsRoot,
    sessionId: requireSessionId(opts.sessionId),
  });

  const jsonMode = isJsonMode(opts);
  if (jsonMode) {
    writeJson({ session: record }, Boolean(opts.pretty));
  } else {
    process.stdout.write(`${formatSessionShow(record)}\n`);
  }

  return record;
}

export const sessionsShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show details for a single session by ID",
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
    await runSessionsShow({
      sessionId: String(requireSessionId(args.sessionId ? String(args.sessionId) : undefined)),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    });
  },
});

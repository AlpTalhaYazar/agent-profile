import { defineCommand } from "citty";
import { isTTY, promptConfirm } from "../../auth/prompt-secrets.js";
import { CliError, EXIT_USER_CANCELLED } from "../../errors.js";
import { writeJson } from "../../output/json.js";
import { getTransport } from "../../transport/index.js";
import { isJsonMode, requireSessionId } from "./shared.js";
import type { SessionsKillOptions } from "./types.js";

/** Forcefully stop a running session via the daemon. */
export async function runSessionsKill(opts: SessionsKillOptions): Promise<{
  killed: boolean;
  exitCode?: number;
}> {
  const sessionId = requireSessionId(opts.sessionId);
  const jsonMode = isJsonMode(opts);
  const interactive = opts.isInteractive ?? isTTY();
  if (!opts.yes && (jsonMode || !interactive)) {
    throw new CliError(
      `Refusing to kill ${sessionId} without --yes.`,
      EXIT_USER_CANCELLED,
      "Re-run with `--yes` to confirm non-interactively."
    );
  }
  if (!opts.yes && interactive) {
    const prompt = opts.confirm ?? ((message: string) => promptConfirm(message));
    const ok = await prompt(`Kill session ${sessionId}?`);
    if (!ok) {
      throw new CliError("Kill cancelled.", EXIT_USER_CANCELLED);
    }
  }

  const transport = await getTransport({ requireDaemon: true });
  try {
    const killInput: Parameters<typeof transport.sessionsKill>[0] = { sessionId };
    if (opts.signal !== undefined) killInput.signal = opts.signal;
    const result = await transport.sessionsKill(killInput);
    if (jsonMode) {
      writeJson(result, Boolean(opts.pretty));
    } else if (result.killed) {
      const exitCode = result.exitCode !== undefined ? ` (exitCode=${result.exitCode})` : "";
      process.stdout.write(`Killed session ${sessionId}${exitCode}.\n`);
    } else {
      process.stdout.write(`Session ${sessionId} was already exited.\n`);
    }
    return result;
  } finally {
    await transport.close();
  }
}

export const sessionsKillCommand = defineCommand({
  meta: {
    name: "kill",
    description: "Kill a running session via the daemon",
  },
  args: {
    sessionId: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    signal: {
      type: "string",
      description: "Signal to send (SIGTERM | SIGKILL). Default: SIGTERM",
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation prompt (required in non-TTY / --json mode)",
      alias: "y",
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
    const signal =
      args.signal === "SIGKILL" ? "SIGKILL" : args.signal === "SIGTERM" ? "SIGTERM" : undefined;
    const opts: SessionsKillOptions = {
      sessionId: String(requireSessionId(args.sessionId ? String(args.sessionId) : undefined)),
      yes: Boolean(args.yes),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    };
    if (signal !== undefined) opts.signal = signal;
    await runSessionsKill(opts);
  },
});

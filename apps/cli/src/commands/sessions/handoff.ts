import {
  type HandoffOutcomeStatus,
  type HandoffVerificationStatus,
  ServiceError,
  sessionsHandoffService,
} from "@agent-profile/cli-services";
import { defineCommand } from "citty";
import { CliError, EXIT_CONFIG_INVALID } from "../../errors.js";
import { writeJson } from "../../output/json.js";
import { myClaudeHome } from "../../utils/paths.js";
import { isJsonMode, requireSessionId, resolveSessionsRoot } from "./shared.js";
import type { SessionsHandoffOptions } from "./types.js";

const VERIFICATION_STATUSES = ["passed", "failed", "not-recorded"] as const;
const OUTCOMES = ["completed", "blocked", "discarded", "needs-relaunch", "not-recorded"] as const;

/** Generate a copyable markdown handoff summary for one recorded session. */
export async function runSessionsHandoff(
  opts: SessionsHandoffOptions
): Promise<Awaited<ReturnType<typeof sessionsHandoffService>>> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const input: Parameters<typeof sessionsHandoffService>[0] = {
    sessionsRoot,
    sessionId: requireSessionId(opts.sessionId),
    home: opts.home ?? myClaudeHome(),
  };

  const verificationStatus = parseVerificationStatus(opts.verificationStatus);
  if (verificationStatus !== undefined) input.verificationStatus = verificationStatus;
  if (opts.verificationCommand !== undefined) input.verificationCommand = opts.verificationCommand;
  const outcome = parseOutcome(opts.outcome);
  if (outcome !== undefined) input.outcome = outcome;

  try {
    const result = await sessionsHandoffService(input);
    if (isJsonMode(opts)) {
      writeJson(result, Boolean(opts.pretty));
    } else {
      process.stdout.write(`${result.markdown}\n`);
    }
    return result;
  } catch (err) {
    if (err instanceof ServiceError) {
      throw new CliError(err.message, err.exitCode);
    }
    throw err;
  }
}

function parseVerificationStatus(value: string | undefined): HandoffVerificationStatus | undefined {
  if (value === undefined) return undefined;
  if (isOneOf(value, VERIFICATION_STATUSES)) return value;
  throw new CliError(
    `Invalid verification status "${value}". Expected one of: ${VERIFICATION_STATUSES.join(", ")}.`,
    EXIT_CONFIG_INVALID
  );
}

function parseOutcome(value: string | undefined): HandoffOutcomeStatus | undefined {
  if (value === undefined) return undefined;
  if (isOneOf(value, OUTCOMES)) return value;
  throw new CliError(
    `Invalid outcome "${value}". Expected one of: ${OUTCOMES.join(", ")}.`,
    EXIT_CONFIG_INVALID
  );
}

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value);
}

export const sessionsHandoffCommand = defineCommand({
  meta: {
    name: "handoff",
    description: "Generate a copyable markdown handoff summary for a session",
  },
  args: {
    sessionId: {
      type: "positional",
      description: "Session ID",
      required: true,
    },
    "verification-status": {
      type: "string",
      description: "Verification status: passed, failed, or not-recorded",
      default: "not-recorded",
    },
    "verification-command": {
      type: "string",
      description: "Verification command to render in the handoff packet",
    },
    outcome: {
      type: "string",
      description: "Outcome: completed, blocked, discarded, needs-relaunch, or not-recorded",
      default: "not-recorded",
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
  },
  async run({ args }) {
    await runSessionsHandoff({
      sessionId: String(requireSessionId(args.sessionId ? String(args.sessionId) : undefined)),
      verificationStatus: String(args["verification-status"]),
      ...(args["verification-command"] !== undefined
        ? { verificationCommand: String(args["verification-command"]) }
        : {}),
      outcome: String(args.outcome),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
      ...(args.home !== undefined ? { home: String(args.home) } : {}),
    });
  },
});

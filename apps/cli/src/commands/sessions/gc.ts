import { stat } from "node:fs/promises";
import { cleanupSession, listOrphanedSessions } from "@agent-profile/persona-deployer";
import { defineCommand } from "citty";
import { isTTY, promptConfirm } from "../../auth/prompt-secrets.js";
import { CliError, EXIT_USER_CANCELLED } from "../../errors.js";
import { writeJson } from "../../output/json.js";
import {
  type SessionRecord,
  listSessionRecords,
  updateSessionRecord,
} from "../../session/registry.js";
import { formatGcResult } from "./format.js";
import { isJsonMode, resolveSessionsRoot } from "./shared.js";
import type { SessionsGcOptions, SessionsGcResult } from "./types.js";

/** Clean session directories using persona-deployer's guarded cleanupSession. */
export async function runSessionsGc(opts: SessionsGcOptions = {}): Promise<SessionsGcResult> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const includeRetained = Boolean(opts.includeRetained);
  const yes = Boolean(opts.yes);
  const jsonMode = isJsonMode(opts);
  const result: SessionsGcResult = { cleaned: [], skipped: [] };
  const records = await listSessionRecords({ sessionsRoot });
  const recordsById = new Map(records.map((record) => [record.sessionId, record]));
  const cleanedIds = new Set<string>();

  if (includeRetained && !yes) {
    const retainedCandidates = records.filter(
      (record) => record.retained && record.status !== "running" && !record.cleaned
    );
    if (retainedCandidates.length > 0) {
      const confirmInput: ConfirmRetainedDeletionInput = {
        retained: retainedCandidates,
        jsonMode,
        interactive: opts.isInteractive ?? isTTY(),
      };
      if (opts.confirm !== undefined) confirmInput.confirm = opts.confirm;
      await confirmRetainedDeletion(confirmInput);
    }
  }

  for (const record of records) {
    if (record.retained && !includeRetained) {
      result.skipped.push({
        sessionId: record.sessionId,
        sessionDir: record.runtimePaths.sessionDir,
        reason: "retained",
      });
      continue;
    }
    if (record.status === "running") {
      result.skipped.push({
        sessionId: record.sessionId,
        sessionDir: record.runtimePaths.sessionDir,
        reason: "running",
      });
      continue;
    }
    if (!(await pathExists(record.runtimePaths.sessionDir))) {
      if (!record.cleaned) {
        await markCleaned(sessionsRoot, record);
      }
      continue;
    }

    await cleanupSession(record.runtimePaths.sessionDir, { allowedRoots: [sessionsRoot] });
    await markCleaned(sessionsRoot, record);
    cleanedIds.add(record.sessionId);
    const cleanedEntry: SessionsGcResult["cleaned"][number] = {
      sessionId: record.sessionId,
      sessionDir: record.runtimePaths.sessionDir,
      source: "registry",
    };
    if (record.retained) cleanedEntry.retained = true;
    result.cleaned.push(cleanedEntry);
  }

  if (opts.all) {
    const orphans = await listOrphanedSessions({ root: sessionsRoot });
    for (const orphan of orphans) {
      if (cleanedIds.has(orphan.sessionId)) continue;
      const record = recordsById.get(orphan.sessionId);
      if (record?.retained && !includeRetained) {
        result.skipped.push({
          sessionId: orphan.sessionId,
          sessionDir: orphan.sessionDir,
          reason: "retained",
        });
        continue;
      }
      if (record?.status === "running") {
        result.skipped.push({
          sessionId: orphan.sessionId,
          sessionDir: orphan.sessionDir,
          reason: "running",
        });
        continue;
      }

      await cleanupSession(orphan.sessionDir, { allowedRoots: [sessionsRoot] });
      if (record) {
        await markCleaned(sessionsRoot, record);
      }
      cleanedIds.add(orphan.sessionId);
      const cleanedEntry: SessionsGcResult["cleaned"][number] = {
        sessionId: orphan.sessionId,
        sessionDir: orphan.sessionDir,
        source: "orphan",
      };
      if (record?.retained) cleanedEntry.retained = true;
      result.cleaned.push(cleanedEntry);
    }
  }

  if (jsonMode) {
    writeJson(result, Boolean(opts.pretty));
  } else {
    process.stdout.write(formatGcResult(result));
  }

  return result;
}

interface ConfirmRetainedDeletionInput {
  retained: SessionRecord[];
  jsonMode: boolean;
  interactive: boolean;
  confirm?: (message: string) => Promise<boolean>;
}

/**
 * Guards retained-session deletion with the rule: JSON or non-TTY requires
 * an explicit `--yes`, else exit 6; TTY prompts for confirmation.
 */
async function confirmRetainedDeletion(input: ConfirmRetainedDeletionInput): Promise<void> {
  const list = input.retained
    .map((record) => `  ${record.sessionId}  ${record.runtimePaths.sessionDir}`)
    .join("\n");
  if (input.jsonMode || !input.interactive) {
    throw new CliError(
      `Refusing to delete ${input.retained.length} retained session(s) without --yes.`,
      EXIT_USER_CANCELLED,
      "Re-run with `--include-retained --yes` to confirm non-interactively."
    );
  }
  process.stderr.write(`About to delete ${input.retained.length} retained session(s):\n${list}\n`);
  const prompt = input.confirm ?? ((message: string) => promptConfirm(message));
  const ok = await prompt("Delete these retained sessions?");
  if (!ok) {
    throw new CliError("Retained-session cleanup cancelled.", EXIT_USER_CANCELLED);
  }
}

async function markCleaned(sessionsRoot: string, record: SessionRecord): Promise<void> {
  await updateSessionRecord({
    sessionsRoot,
    sessionId: record.sessionId,
    patch: {
      cleaned: true,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export const sessionsGcCommand = defineCommand({
  meta: {
    name: "gc",
    description: "Clean exited session directories (retained sessions are skipped by default)",
  },
  args: {
    all: {
      type: "boolean",
      description: "Also clean old orphan directories under the sessions root",
      default: false,
    },
    "include-retained": {
      type: "boolean",
      description: "Also delete sessions marked retained (requires confirmation or --yes)",
      default: false,
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
    await runSessionsGc({
      all: Boolean(args.all),
      includeRetained: Boolean(args["include-retained"]),
      yes: Boolean(args.yes),
      json: Boolean(args.json),
      pretty: Boolean(args.pretty),
    });
  },
});

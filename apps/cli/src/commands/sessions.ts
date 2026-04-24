/**
 * @module commands/sessions
 *
 * File-backed `myclaude sessions` commands for Phase 1 CLI-only workflows.
 */
import { stat } from "node:fs/promises";
import {
  cleanupSession,
  listOrphanedSessions,
  sessionsRootDefault,
} from "@agent-profile/persona-deployer";
import { defineCommand } from "citty";
import { isTTY, promptConfirm } from "../auth/prompt-secrets.js";
import { CliError, EXIT_GENERIC, EXIT_USER_CANCELLED } from "../errors.js";
import { writeJson } from "../output/json.js";
import {
  type SessionRecord,
  listSessionRecords,
  readSessionRecord,
  updateSessionRecord,
} from "../session/registry.js";

export interface SessionsBaseOptions {
  sessionsRoot?: string;
  env?: Record<string, string | undefined>;
  json?: boolean;
  pretty?: boolean;
}

export interface SessionsListOptions extends SessionsBaseOptions {
  active?: boolean;
  all?: boolean;
  nowMs?: number;
}

export interface SessionsShowOptions extends SessionsBaseOptions {
  sessionId: string;
}

export interface SessionsGcOptions extends SessionsBaseOptions {
  /** Also clean old orphan directories under the sessions root. */
  all?: boolean;
  /**
   * Include sessions marked `retained` as cleanup candidates.
   * Requires either interactive confirmation or `--yes` (non-TTY / JSON mode).
   */
  includeRetained?: boolean;
  /** Skip confirmation prompts (required in non-TTY / JSON mode when deleting retained). */
  yes?: boolean;
  /**
   * Injected confirmation function for tests. When omitted, the real interactive
   * prompt is used in TTY mode. Never invoked in non-TTY / `--json` mode.
   */
  confirm?: (message: string) => Promise<boolean>;
  /** Force non-TTY behavior for tests (overrides the real TTY detection). */
  isInteractive?: boolean;
}

export interface SessionsGcResult {
  cleaned: Array<{
    sessionId: string;
    sessionDir: string;
    source: "registry" | "orphan";
    retained?: boolean;
  }>;
  skipped: Array<{ sessionId: string; sessionDir: string; reason: string }>;
}

/** List active and recent sessions from the registry. */
export async function runSessionsList(opts: SessionsListOptions = {}): Promise<SessionRecord[]> {
  const sessionsRoot = resolveSessionsRoot(opts);
  let records = await listSessionRecords({ sessionsRoot });
  if (opts.active) {
    records = records.filter((record) => record.status === "running");
  }

  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);
  if (jsonMode) {
    writeJson({ sessions: records }, Boolean(opts.pretty));
  } else {
    process.stdout.write(`${formatSessionList(records, opts.nowMs ?? Date.now())}\n`);
  }

  return records;
}

/** Show one session record in detail. */
export async function runSessionsShow(opts: SessionsShowOptions): Promise<SessionRecord> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const record = await readSessionRecord({ sessionsRoot, sessionId: opts.sessionId });

  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);
  if (jsonMode) {
    writeJson({ session: record }, Boolean(opts.pretty));
  } else {
    process.stdout.write(`${formatSessionShow(record)}\n`);
  }

  return record;
}

/** Clean session directories using persona-deployer's guarded cleanupSession. */
export async function runSessionsGc(opts: SessionsGcOptions = {}): Promise<SessionsGcResult> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const includeRetained = Boolean(opts.includeRetained);
  const yes = Boolean(opts.yes);
  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);
  const result: SessionsGcResult = { cleaned: [], skipped: [] };
  const records = await listSessionRecords({ sessionsRoot });
  const recordsById = new Map(records.map((record) => [record.sessionId, record]));
  const cleanedIds = new Set<string>();

  if (includeRetained && !yes) {
    const retainedCandidates = records.filter(
      (r) => r.retained && r.status !== "running" && !r.cleaned
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
    .map((r) => `  ${r.sessionId}  ${r.runtimePaths.sessionDir}`)
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

export const sessionsCommand = defineCommand({
  meta: {
    name: "sessions",
    description: "List, inspect, and garbage-collect Agent Profile sessions",
  },
  subCommands: {
    list: defineCommand({
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
      },
      async run({ args }) {
        await runSessionsList({
          active: Boolean(args.active),
          all: Boolean(args.all),
          json: Boolean(args.json),
          pretty: Boolean(args.pretty),
        });
      },
    }),
    show: defineCommand({
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
        if (!args.sessionId) {
          throw new CliError("Session id is required.", EXIT_GENERIC);
        }
        await runSessionsShow({
          sessionId: String(args.sessionId),
          json: Boolean(args.json),
          pretty: Boolean(args.pretty),
        });
      },
    }),
    gc: defineCommand({
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
    }),
  },
});

function resolveSessionsRoot(opts: SessionsBaseOptions): string {
  return opts.sessionsRoot ?? opts.env?.MYCLAUDE_SESSIONS_ROOT ?? sessionsRootDefault();
}

function formatSessionList(records: SessionRecord[], nowMs: number): string {
  if (records.length === 0) {
    return "No sessions found.";
  }

  const lines = [
    `${"ID".padEnd(38)}${"ROLE".padEnd(14)}${"AUTH".padEnd(14)}${"STARTED".padEnd(12)}${"STATUS".padEnd(10)}DIR`,
  ];
  for (const record of records) {
    const dir = record.cleaned ? "(cleaned)" : record.runtimePaths.sessionDir;
    lines.push(
      `${record.sessionId.padEnd(38)}${record.role.padEnd(14)}${record.authProfileId.padEnd(14)}${formatAge(
        nowMs - Date.parse(record.createdAt)
      ).padEnd(12)}${record.status.padEnd(10)}${dir}`
    );
  }
  return lines.join("\n");
}

function formatSessionShow(record: SessionRecord): string {
  const args = record.spawn.args.length > 0 ? record.spawn.args.join(" ") : "(none)";
  const lines = [
    `ID:       ${record.sessionId}`,
    `Role:     ${record.role}`,
    `Auth:     ${record.authProfileId}`,
    `Cwd:      ${record.cwd}`,
    `Created:  ${record.createdAt}`,
    `Updated:  ${record.updatedAt}`,
    `Status:   ${record.status}`,
    `Retained: ${record.retained ? "yes" : "no"}`,
    `Cleaned:  ${record.cleaned ? "yes" : "no"}`,
    `Dir:      ${record.cleaned ? "(cleaned)" : record.runtimePaths.sessionDir}`,
    `Command:  ${record.spawn.command} ${args}`,
  ];
  if (record.exitCode !== undefined) lines.push(`Exit:     ${record.exitCode}`);
  if (record.wallMs !== undefined) lines.push(`Wall ms:  ${record.wallMs}`);
  lines.push(`mcp.json: ${record.runtimePaths.mcpConfig}`);
  lines.push(`settings: ${record.runtimePaths.settings}`);
  return lines.join("\n");
}

function formatGcResult(result: SessionsGcResult): string {
  const lines: string[] = [];
  const retainedCount = result.cleaned.filter((e) => e.retained).length;
  const summary =
    retainedCount > 0
      ? `Cleaned ${result.cleaned.length} session dir(s) (${retainedCount} retained).`
      : `Cleaned ${result.cleaned.length} session dir(s).`;
  lines.push(summary);
  for (const entry of result.cleaned) {
    const tag = entry.retained ? " [retained]" : "";
    lines.push(`  ${entry.sessionId}${tag} ${entry.sessionDir}`);
  }
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} session dir(s).`);
    for (const entry of result.skipped) {
      lines.push(`  ${entry.sessionId} ${entry.reason} ${entry.sessionDir}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "now";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

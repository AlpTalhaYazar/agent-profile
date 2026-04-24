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
import { CliError, EXIT_GENERIC } from "../errors.js";
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
  all?: boolean;
}

export interface SessionsGcResult {
  cleaned: Array<{ sessionId: string; sessionDir: string; source: "registry" | "orphan" }>;
  skipped: Array<{ sessionId: string; sessionDir: string; reason: string }>;
}

/** List active and recent sessions from the registry. */
export async function runSessionsList(opts: SessionsListOptions = {}): Promise<SessionRecord[]> {
  const sessionsRoot = resolveSessionsRoot(opts);
  let records = await listSessionRecords({ sessionsRoot });
  if (opts.active) {
    records = records.filter((record) => record.status === "running");
  }

  if (opts.json) {
    writeJson({ sessions: records }, opts.pretty ?? false);
  } else {
    process.stdout.write(`${formatSessionList(records, opts.nowMs ?? Date.now())}\n`);
  }

  return records;
}

/** Show one session record in detail. */
export async function runSessionsShow(opts: SessionsShowOptions): Promise<SessionRecord> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const record = await readSessionRecord({ sessionsRoot, sessionId: opts.sessionId });

  if (opts.json) {
    writeJson({ session: record }, opts.pretty ?? false);
  } else {
    process.stdout.write(`${formatSessionShow(record)}\n`);
  }

  return record;
}

/** Clean session directories using persona-deployer's guarded cleanupSession. */
export async function runSessionsGc(opts: SessionsGcOptions = {}): Promise<SessionsGcResult> {
  const sessionsRoot = resolveSessionsRoot(opts);
  const result: SessionsGcResult = { cleaned: [], skipped: [] };
  const records = await listSessionRecords({ sessionsRoot });
  const recordsById = new Map(records.map((record) => [record.sessionId, record]));
  const cleanedIds = new Set<string>();

  for (const record of records) {
    if (record.retained) {
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
    result.cleaned.push({
      sessionId: record.sessionId,
      sessionDir: record.runtimePaths.sessionDir,
      source: "registry",
    });
  }

  if (opts.all) {
    const orphans = await listOrphanedSessions({ root: sessionsRoot });
    for (const orphan of orphans) {
      if (cleanedIds.has(orphan.sessionId)) continue;
      const record = recordsById.get(orphan.sessionId);
      if (record?.retained) {
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
      result.cleaned.push({
        sessionId: orphan.sessionId,
        sessionDir: orphan.sessionDir,
        source: "orphan",
      });
    }
  }

  if (opts.json) {
    writeJson(result, opts.pretty ?? false);
  } else {
    process.stdout.write(formatGcResult(result));
  }

  return result;
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
        description: "List active and recent sessions",
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
          description: "Emit structured JSON",
          alias: "j",
          default: false,
        },
        pretty: {
          type: "boolean",
          description: "Pretty-print JSON output",
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
        description: "Show one session",
      },
      args: {
        sessionId: {
          type: "positional",
          description: "Session ID",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Emit structured JSON",
          alias: "j",
          default: false,
        },
        pretty: {
          type: "boolean",
          description: "Pretty-print JSON output",
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
        description: "Clean exited session directories",
      },
      args: {
        all: {
          type: "boolean",
          description: "Also clean old orphan directories under the sessions root",
          default: false,
        },
        json: {
          type: "boolean",
          description: "Emit structured JSON",
          alias: "j",
          default: false,
        },
        pretty: {
          type: "boolean",
          description: "Pretty-print JSON output",
          default: false,
        },
      },
      async run({ args }) {
        await runSessionsGc({
          all: Boolean(args.all),
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
  lines.push(`Cleaned ${result.cleaned.length} session dir(s).`);
  for (const entry of result.cleaned) {
    lines.push(`  ${entry.sessionId} ${entry.sessionDir}`);
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

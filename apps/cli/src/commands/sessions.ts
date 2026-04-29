/**
 * @module commands/sessions
 *
 * File-backed `myclaude sessions` commands. Phase 2 milestone 5 added the
 * daemon-routed kill/relaunch/drift subcommands plus `list --follow` for the
 * unsolicited push-event channel.
 */
import { stat } from "node:fs/promises";
import type { EvtSessionsEventT } from "@agent-profile/ipc-protocol";
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
import { getTransport } from "../transport/index.js";
import { myClaudeHome } from "../utils/paths.js";

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
  /** Override myclaude home directory (cookie lookup). */
  home?: string;
  /** Exit 4 if the daemon is unreachable instead of falling back to standalone. */
  requireDaemon?: boolean;
  /** Force standalone path; skip the daemon attempt entirely. */
  standalone?: boolean;
  /**
   * When true, after the initial snapshot the command keeps a daemon
   * subscription open and prints every `sessions.event` push frame. SIGINT
   * disposes the subscription cleanly. Daemon-only.
   */
  follow?: boolean;
}

export interface SessionsKillOptions extends SessionsBaseOptions {
  sessionId: string;
  signal?: "SIGTERM" | "SIGKILL";
  yes?: boolean;
  isInteractive?: boolean;
  confirm?: (message: string) => Promise<boolean>;
}

export interface SessionsRelaunchOptions extends SessionsBaseOptions {
  sessionId: string;
}

export interface SessionsDriftOptions extends SessionsBaseOptions {
  sessionId: string;
  home?: string;
  standalone?: boolean;
  requireDaemon?: boolean;
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
  const followMode = Boolean(opts.follow);

  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.home !== undefined) transportOpts.home = opts.home;
  if (followMode) {
    // --follow only makes sense over the daemon; force-require it so we
    // don't silently degrade to a one-shot in-process snapshot.
    transportOpts.requireDaemon = true;
  } else if (opts.requireDaemon !== undefined) {
    transportOpts.requireDaemon = opts.requireDaemon;
  }
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;
  const transport = await getTransport(transportOpts);

  let records: SessionRecord[];
  try {
    records = await transport.sessionsList({
      sessionsRoot,
      activeOnly: Boolean(opts.active),
    });

    const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);
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

/** Long-poll-style session event stream (used by `sessions list --follow`). */
async function streamSessionsEvents(
  transport: Awaited<ReturnType<typeof getTransport>>,
  jsonMode: boolean
): Promise<void> {
  const events: EvtSessionsEventT[] = [];
  let pendingResolve: ((value: undefined) => void) | null = null;
  let stopped = false;

  const handle = await transport.sessionsSubscribe({
    onEvent: (event) => {
      events.push(event);
      pendingResolve?.(undefined);
      pendingResolve = null;
    },
  });

  const onSigint = (): void => {
    stopped = true;
    pendingResolve?.(undefined);
    pendingResolve = null;
  };
  process.once("SIGINT", onSigint);

  try {
    while (!stopped) {
      while (events.length > 0) {
        const event = events.shift();
        if (!event) break;
        if (jsonMode) {
          writeJson(event, false);
        } else {
          process.stdout.write(`${formatSessionEvent(event)}\n`);
        }
      }
      if (stopped) break;
      await new Promise<undefined>((resolve) => {
        pendingResolve = resolve;
      });
    }
  } finally {
    handle.unsubscribe();
    process.removeListener("SIGINT", onSigint);
  }
}

function formatSessionEvent(event: EvtSessionsEventT): string {
  const ts = new Date(event.ts).toISOString();
  const exitCode = event.exitCode !== undefined ? ` exitCode=${event.exitCode}` : "";
  return `[${ts}] ${event.sessionId} ${event.event}${exitCode}`;
}

/** Forcefully stop a running session via the daemon. */
export async function runSessionsKill(opts: SessionsKillOptions): Promise<{
  killed: boolean;
  exitCode?: number;
}> {
  if (!opts.sessionId) {
    throw new CliError("Session id is required.", EXIT_GENERIC);
  }
  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);
  const interactive = opts.isInteractive ?? isTTY();
  if (!opts.yes && (jsonMode || !interactive)) {
    throw new CliError(
      `Refusing to kill ${opts.sessionId} without --yes.`,
      EXIT_USER_CANCELLED,
      "Re-run with `--yes` to confirm non-interactively."
    );
  }
  if (!opts.yes && interactive) {
    const prompt = opts.confirm ?? ((message: string) => promptConfirm(message));
    const ok = await prompt(`Kill session ${opts.sessionId}?`);
    if (!ok) {
      throw new CliError("Kill cancelled.", EXIT_USER_CANCELLED);
    }
  }

  const transport = await getTransport({ requireDaemon: true });
  try {
    const killInput: Parameters<typeof transport.sessionsKill>[0] = {
      sessionId: opts.sessionId,
    };
    if (opts.signal !== undefined) killInput.signal = opts.signal;
    const result = await transport.sessionsKill(killInput);
    if (jsonMode) {
      writeJson(result, Boolean(opts.pretty));
    } else if (result.killed) {
      const exitCode = result.exitCode !== undefined ? ` (exitCode=${result.exitCode})` : "";
      process.stdout.write(`Killed session ${opts.sessionId}${exitCode}.\n`);
    } else {
      process.stdout.write(`Session ${opts.sessionId} was already exited.\n`);
    }
    return result;
  } finally {
    await transport.close();
  }
}

/** Spawn a fresh session with the same role/auth/cwd as an existing one. */
export async function runSessionsRelaunch(opts: SessionsRelaunchOptions): Promise<{
  sessionId: string;
  relaunchedFrom: string;
}> {
  if (!opts.sessionId) {
    throw new CliError("Session id is required.", EXIT_GENERIC);
  }
  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);
  const transport = await getTransport({ requireDaemon: true });
  try {
    const result = await transport.sessionsRelaunch({ sessionId: opts.sessionId });
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

/** Recompute and compare the launch hash for a session. */
export async function runSessionsDrift(opts: SessionsDriftOptions): Promise<{
  drifted: boolean;
  scopesChanged: string[];
  oldHash: string;
  newHash: string;
}> {
  if (!opts.sessionId) {
    throw new CliError("Session id is required.", EXIT_GENERIC);
  }
  const sessionsRoot = resolveSessionsRoot(opts);
  const home = opts.home ?? myClaudeHome();
  const jsonMode = Boolean(opts.json) || Boolean(opts.pretty);

  const transportOpts: Parameters<typeof getTransport>[0] = {};
  if (opts.requireDaemon !== undefined) transportOpts.requireDaemon = opts.requireDaemon;
  if (opts.standalone !== undefined) transportOpts.standalone = opts.standalone;
  const transport = await getTransport(transportOpts);

  try {
    const result = await transport.sessionsDrift({
      sessionsRoot,
      sessionId: opts.sessionId,
      home,
    });
    if (jsonMode) {
      writeJson(result, Boolean(opts.pretty));
    } else {
      const flag = result.drifted ? "DRIFTED" : "in sync";
      process.stdout.write(`Session ${opts.sessionId}: ${flag}\n`);
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
    }),
    kill: defineCommand({
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
        if (!args.sessionId) {
          throw new CliError("Session id is required.", EXIT_GENERIC);
        }
        const signal =
          args.signal === "SIGKILL" ? "SIGKILL" : args.signal === "SIGTERM" ? "SIGTERM" : undefined;
        const opts: SessionsKillOptions = {
          sessionId: String(args.sessionId),
          yes: Boolean(args.yes),
          json: Boolean(args.json),
          pretty: Boolean(args.pretty),
        };
        if (signal !== undefined) opts.signal = signal;
        await runSessionsKill(opts);
      },
    }),
    relaunch: defineCommand({
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
        if (!args.sessionId) {
          throw new CliError("Session id is required.", EXIT_GENERIC);
        }
        await runSessionsRelaunch({
          sessionId: String(args.sessionId),
          json: Boolean(args.json),
          pretty: Boolean(args.pretty),
        });
      },
    }),
    drift: defineCommand({
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
        if (!args.sessionId) {
          throw new CliError("Session id is required.", EXIT_GENERIC);
        }
        await runSessionsDrift({
          sessionId: String(args.sessionId),
          json: Boolean(args.json),
          pretty: Boolean(args.pretty),
          standalone: Boolean(args.standalone),
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

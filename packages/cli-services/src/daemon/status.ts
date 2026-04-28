/**
 * @module daemon/status
 *
 * Pure data service that aggregates the daemon's runtime status.
 *
 * The desktop daemon (Phase 2) exposes `daemon status` over IPC; the CLI
 * (`myclaude daemon status`) consumes the same shape. Inputs come entirely
 * from the caller — the daemon process knows its own pid, socket, and start
 * time; this service merely combines them with the on-disk session-count
 * snapshot so neither caller has to duplicate the aggregation logic.
 */
import { sessionsListService } from "../sessions/list.js";

/**
 * Input options for `daemonStatusService`.
 *
 * `nowMs` is injectable so tests can pin uptime deterministically; the real
 * daemon and CLI both pass `Date.now()`.
 */
export interface DaemonStatusInput {
  /** The daemon process id. */
  pid: number;
  /** Absolute path of the IPC socket the daemon is listening on. */
  socketPath: string;
  /** The wall-clock time (ms since epoch) when the daemon process started. */
  startedAtMs: number;
  /** The configured sessions root used to count active/total sessions. */
  sessionsRoot: string;
  /** Override `Date.now()` for tests. Defaults to the real clock. */
  nowMs?: number;
}

/**
 * Daemon-status payload returned over IPC and printed by the CLI.
 */
export interface DaemonStatus {
  /** Daemon process id. */
  pid: number;
  /** Absolute path of the IPC socket. */
  socketPath: string;
  /** Milliseconds since the daemon process started. Never negative. */
  uptimeMs: number;
  /** Snapshot of the file-backed session counts at call time. */
  sessionCounts: {
    /** Number of records with `status: "running"`. */
    active: number;
    /** Number of records of any status. */
    total: number;
  };
}

/**
 * Compute the daemon status given a snapshot of process metadata and the
 * sessions root.
 *
 * @param input - Daemon process metadata + sessions root.
 * @returns The aggregated status. Throws only if `sessionsListService` does.
 */
export async function daemonStatusService(input: DaemonStatusInput): Promise<DaemonStatus> {
  const now = input.nowMs ?? Date.now();
  const uptimeMs = Math.max(0, now - input.startedAtMs);

  const allRecords = await sessionsListService({ sessionsRoot: input.sessionsRoot });
  const active = allRecords.reduce(
    (count, record) => (record.status === "running" ? count + 1 : count),
    0
  );

  return {
    pid: input.pid,
    socketPath: input.socketPath,
    uptimeMs,
    sessionCounts: {
      active,
      total: allRecords.length,
    },
  };
}

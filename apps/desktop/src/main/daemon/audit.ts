/**
 * @module daemon/audit
 *
 * Append-only JSONL audit log at `<myClaudeHome>/audit.log` (mode 0600).
 *
 * Schema is aligned with the SQLite tables planned in `docs/06-security.md` so
 * a future migration can re-key these JSONL rows into rows of the
 * `launches` / `secret_accesses` / `config_changes` tables without
 * re-shaping. SQLite migration is deferred to Phase 3 (open question #24).
 *
 * Security:
 *  - Never log a secret value. Only logical names (`secretName: "anthropic"`)
 *    or namespaced keys (`agent-profile.anthropic.work`).
 *  - File permissions are clamped to 0600 on every append (POSIX).
 *  - `appendFile` is line-atomic up to PIPE_BUF (4 KiB) on POSIX, which our
 *    rows comfortably fit under, so concurrent writers do not interleave.
 */

import { appendFile, chmod, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

/** Discriminated union for every audit row the daemon writes. */
export type AuditEntry = LaunchEntry | SecretAccessEntry | ConfigChangeEntry;

/** Maps onto `launches` table — one row per session lifecycle event. */
export interface LaunchEntry {
  kind: "launch";
  ts: number;
  /** session id (ULID-style) */
  sessionId: string;
  /** "started" | "ended" | "killed" */
  event: "started" | "ended" | "killed";
  /** spawned process pid; 0 if unknown */
  spawnPid: number;
  role?: string;
  authProfileId?: string;
  cwd?: string;
  /**
   * For sessions started via `sessions.relaunch`, the parent session id this
   * session was cloned from. Absent on first-launch entries.
   */
  relaunchedFrom?: string;
}

/** Maps onto `secret_accesses` — one row per `secret.get` call. */
export interface SecretAccessEntry {
  kind: "secret_access";
  ts: number;
  sessionId: string;
  /** logical name, NOT value */
  secretName: string;
  callerPid: number;
  /** whether the capability token verified */
  capabilityValid: boolean;
  /** verification failure reason ("expired" | "revoked" | …) when invalid */
  reason?: string;
}

/** Maps onto `config_changes` — one row per write that mutates auth metadata. */
export interface ConfigChangeEntry {
  kind: "config_change";
  ts: number;
  /** "auth.add" | "auth.setSecret" | "auth.rotate" | "auth.remove" */
  actionKind: string;
  actor: "daemon" | "cli" | "gui";
  /** the auth profile id (or `"<authId>.<secretName>"` for setSecret) */
  target: string;
  /** Reserved; left null until we hash diffs in Phase 3. */
  diffSha256?: string | null;
}

/** Constructor options for {@link AuditLog}. */
export interface AuditLogOptions {
  /** Absolute path to the JSONL file. */
  filePath: string;
  /** Clock for `ts`; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * JSONL audit logger. One instance per daemon process.
 *
 * `append` resolves once the row is on disk. Failures are surfaced as thrown
 * promises; the daemon decides whether to fail the request or merely log.
 * The current handlers fail the request — losing audit visibility on a
 * critical write would be worse than rolling back.
 */
export class AuditLog {
  private readonly filePath: string;
  private readonly now: () => number;
  private dirEnsured = false;

  constructor(opts: AuditLogOptions) {
    this.filePath = opts.filePath;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Append a single row. The caller may omit `ts`; we fill it in.
   *
   * Returns the entry as written, including the resolved timestamp, so
   * callers can assert against it in tests.
   */
  async append(
    entry: Omit<LaunchEntry, "ts"> | Omit<SecretAccessEntry, "ts"> | Omit<ConfigChangeEntry, "ts">
  ): Promise<AuditEntry> {
    const ts = (entry as { ts?: number }).ts ?? this.now();
    const row = { ...entry, ts } as AuditEntry;
    if (!this.dirEnsured) {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      this.dirEnsured = true;
    }
    const line = `${JSON.stringify(row)}\n`;
    await appendFile(this.filePath, line, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") {
      try {
        const s = await stat(this.filePath);
        // Ensure the file mode stays 0600 even if a previous run created it
        // with a different umask. chmod is cheap and idempotent.
        if ((s.mode & 0o777) !== 0o600) {
          await chmod(this.filePath, 0o600);
        }
      } catch {
        // best-effort
      }
    }
    return row;
  }
}

void chmod;

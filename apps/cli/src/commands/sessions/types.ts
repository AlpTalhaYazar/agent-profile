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

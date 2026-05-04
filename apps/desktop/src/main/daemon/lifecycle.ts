/**
 * @module daemon/lifecycle
 *
 * Daemon-process lifecycle for the desktop app.
 *
 * The class wraps {@link DaemonServer} with three concerns Main needs to own:
 *
 *   - **Bookkeeping.** The pid, socket path, and start time are read both by
 *     `daemon.status` (over IPC) and by `daemon.lock` (sidecar JSON file used
 *     for diagnostics — `app.requestSingleInstanceLock()` is the actual lock).
 *
 *   - **Shutdown semantics.** `requestShutdown()` flips a flag and tells
 *     Electron to quit; the actual drain happens in `app.on('before-quit')`
 *     so renderer state has a chance to clean up. `drainAndClose()` runs the
 *     server's drain, removes the lockfile, and resolves.
 *
 *   - **Sessions root.** Surfaced to the handler factory so `sessions.list`
 *     and `daemon.status` agree on which directory holds session records.
 *
 * Usage from `main/index.ts`:
 *
 * ```ts
 * const lifecycle = new DaemonLifecycle();
 * await lifecycle.start({ socketPath, cookie, serverVersion, home });
 * app.on('before-quit', async (e) => {
 *   e.preventDefault();
 *   await lifecycle.drainAndClose();
 *   app.exit(0);
 * });
 * ```
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DaemonServer, type EvtT, type HandlerMap } from "@agent-profile/ipc-protocol";
import type { WriteHandlerDeps } from "./handlers-write.js";
import { type LifecycleHandle, createHandlers } from "./handlers.js";
import { verifyPeer } from "./peer-auth.js";

/** Local mirror of `sessionsRootDefault()` parameterised by home. */
function sessionsRootFor(home: string): string {
  return join(home, ".myclaude", "sessions");
}

function sessionsRootForMyClaude(myClaudeHome: string): string {
  return join(myClaudeHome, "sessions");
}

/** Options for {@link DaemonLifecycle.start}. */
export interface LifecycleStartOpts {
  /** Filesystem socket path (POSIX) or `\\.\pipe\...` (Windows). */
  socketPath: string;
  /** Boot cookie clients must present in `hello`. */
  cookie: string;
  /** Server version advertised in `hello.ok`. */
  serverVersion: string;
  /**
   * Override for the user's home dir. Defaults to `os.homedir()`. Tests pass
   * a tmpdir to keep the lockfile and session reads isolated.
   */
  home?: string;
  /**
   * Override for the daemon process id. Defaults to `process.pid`. Exists so
   * tests can pin a stable value rather than asserting against the runner pid.
   */
  pid?: number;
  /**
   * Optional `requestShutdown` override. The real Main passes a callback that
   * calls `app.quit()`; tests pass a no-op or a spy.
   */
  requestShutdown?: () => void;
  /** Optional `Date.now()` override for deterministic startedAt timestamps. */
  nowMs?: number;
  /**
   * Write-side handler dependencies. When provided, the daemon advertises and
   * serves the credential / session / migrate kinds. When omitted (e.g. unit
   * tests that only exercise read handlers), the daemon only serves the
   * read-only surface.
   */
  writeHandlers?: WriteHandlerDeps;
}

/** Shape persisted to `~/.myclaude/daemon.lock` for diagnostic introspection. */
interface DaemonLockFile {
  pid: number;
  socketPath: string;
  startedAt: string;
}

/**
 * Daemon process lifecycle handle.
 *
 * Single-instance per Main process. {@link start} may only be called once;
 * call {@link drainAndClose} to tear down.
 */
export class DaemonLifecycle {
  private server: DaemonServer | null = null;
  private home: string = homedir();
  private myClaudeHome: string = join(homedir(), ".myclaude");
  private pid: number = process.pid;
  private socketPath = "";
  private startedAtMs = 0;
  private sessionsRoot = "";
  private shutdownRequested = false;
  private requestShutdownImpl: () => void = () => {
    // Default no-op so tests that never call start() and somehow trigger
    // requestShutdown don't crash.
  };

  /**
   * Start the daemon: instantiate {@link DaemonServer}, write the diagnostic
   * lockfile, and begin accepting handshakes.
   *
   * @param opts - Connection + identity options.
   * @returns The handle the lifecycle records (also accessible via {@link getStatus}).
   */
  async start(opts: LifecycleStartOpts): Promise<LifecycleHandle> {
    if (this.server) {
      throw new Error("DaemonLifecycle.start called twice");
    }
    this.home = opts.home ?? homedir();
    this.myClaudeHome = opts.writeHandlers?.myClaudeHome ?? join(this.home, ".myclaude");
    this.pid = opts.pid ?? process.pid;
    this.socketPath = opts.socketPath;
    this.startedAtMs = opts.nowMs ?? Date.now();
    this.sessionsRoot = opts.writeHandlers
      ? sessionsRootForMyClaude(this.myClaudeHome)
      : sessionsRootFor(this.home);
    if (opts.requestShutdown) {
      this.requestShutdownImpl = opts.requestShutdown;
    }

    const handle: LifecycleHandle = {
      pid: this.pid,
      socketPath: this.socketPath,
      startedAtMs: this.startedAtMs,
      sessionsRoot: this.sessionsRoot,
      requestShutdown: () => {
        this.shutdownRequested = true;
        this.requestShutdownImpl();
      },
    };

    // The broadcast hook is a closure over `this.server` so the write-side
    // handlers can fan-out `sessions.event` frames to subscribed connections.
    // We thread it through writeHandlers before constructing the server so
    // the closure captures `this.server` lazily — a no-op until `start()`
    // assigns the real instance.
    const broadcast = (evt: EvtT): void => {
      this.server?.broadcast(evt);
    };
    const writeHandlersWithBroadcast: WriteHandlerDeps | undefined = opts.writeHandlers
      ? { ...opts.writeHandlers, broadcast }
      : undefined;
    const handlers: HandlerMap = createHandlers(handle, this.home, writeHandlersWithBroadcast);

    const features = [
      "auth.list",
      "auth.get-secret-ref",
      "profile.show",
      "profile.list",
      "profile.validate",
      "profile.preview",
      "sessions.list",
      "persona.render",
      "daemon.status",
      "daemon.stop",
      "system.bootstrap",
    ];
    if (opts.writeHandlers) {
      features.push(
        "auth.add",
        "auth.setSecret",
        "auth.rotate",
        "auth.remove",
        "profile.save",
        "profile.createScope",
        "session.start",
        "session.end",
        "secret.get",
        "secrets.migrate",
        "sessions.kill",
        "sessions.relaunch",
        "sessions.drift",
        "sessions.subscribe",
        "setup.markComplete"
      );
    }

    this.server = new DaemonServer({
      socketPath: this.socketPath,
      cookie: opts.cookie,
      serverVersion: opts.serverVersion,
      features,
      handlers,
      verifyPeer,
    });

    await this.server.start();
    await this.writeLockFile();
    return handle;
  }

  /**
   * Whether {@link requestShutdown} has been called on the handle returned by
   * {@link start}. The Main process polls this in `before-quit` to decide
   * whether to skip the user-confirmation prompt.
   */
  isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  /**
   * Drain in-flight handlers (up to `drainMs`), close every connection, unlink
   * the socket file, remove the lockfile. Idempotent.
   */
  async drainAndClose(drainMs = 2000): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.drainAndClose({ drainMs });
    } finally {
      this.server = null;
      await this.removeLockFile();
    }
  }

  /** Snapshot of the lifecycle state, used by `daemon.status`. */
  getStatus(): {
    pid: number;
    socketPath: string;
    startedAtMs: number;
    sessionsRoot: string;
  } {
    return {
      pid: this.pid,
      socketPath: this.socketPath,
      startedAtMs: this.startedAtMs,
      sessionsRoot: this.sessionsRoot,
    };
  }

  // ── lockfile (diagnostic, NOT the real lock) ─────────────────────────────

  /**
   * Write `~/.myclaude/daemon.lock` containing pid + socket path. This is
   * **not** the per-user single-instance lock — Electron's
   * `app.requestSingleInstanceLock()` owns that. The file exists for
   * diagnostics ("which pid is the daemon?") and for future tooling.
   */
  private async writeLockFile(): Promise<void> {
    const dir = this.myClaudeHome;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const payload: DaemonLockFile = {
      pid: this.pid,
      socketPath: this.socketPath,
      startedAt: new Date(this.startedAtMs).toISOString(),
    };
    await writeFile(join(dir, "daemon.lock"), JSON.stringify(payload, null, 2), {
      mode: 0o600,
      encoding: "utf8",
    });
  }

  private async removeLockFile(): Promise<void> {
    try {
      await rm(join(this.myClaudeHome, "daemon.lock"), { force: true });
    } catch {
      // best-effort
    }
  }
}

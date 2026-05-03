import { join } from "node:path";
import type * as Pty from "@homebridge/node-pty-prebuilt-multiarch";
import { BrowserWindow } from "electron";
import { runLaunch } from "../../../cli/src/commands/launch/index.js";
import type {
  ClaudeChildProcess,
  ClaudeSpawnOptions,
} from "../../../cli/src/commands/launch/spawn.js";
import type {
  SessionLaunchInput,
  SessionLaunchResult,
  SessionTerminalEvent,
  SessionTerminalOpenResult,
} from "../shared/bridge.js";
import { SESSION_TERMINAL_EVENT_CHANNEL } from "../shared/channels.js";
import { resolveClaudeCommand } from "./claude-command.js";
import { withDaemonClient } from "./daemon/client-runner.js";

interface TerminalSession {
  sessionId: string;
  terminal: Pty.IPty;
  buffer: string;
  closed: boolean;
}

export interface LaunchTerminalSessionContext {
  myClaudeHome: string;
  clientVersion: string;
}

const MAX_BUFFER_CHARS = 80_000;
const terminalSessions = new Map<string, TerminalSession>();
let terminalBackendPromise: Promise<TerminalBackend> | null = null;
let terminalBackendReadyPromise: Promise<void> | null = null;

interface TerminalBackend {
  spawn: typeof import("@homebridge/node-pty-prebuilt-multiarch").spawn;
}

export async function launchTerminalSession(
  input: SessionLaunchInput,
  context: LaunchTerminalSessionContext
): Promise<SessionLaunchResult> {
  const sessionsRoot = join(context.myClaudeHome, "sessions");
  const terminalBackend = await loadTerminalBackend();
  await assertTerminalBackendReady(terminalBackend);
  const claudeCommand = await resolveClaudeCommand();
  let launchError: unknown;
  let settled = false;

  const started = new Promise<SessionLaunchResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Claude launch did not create a terminal session in time."));
    }, 15_000);
    timeout.unref();

    const spawnFn = (
      command: string,
      args: string[],
      options: ClaudeSpawnOptions
    ): ClaudeChildProcess => {
      try {
        const env = normalizeEnv(options.env);
        const sessionId = env.MYCLAUDE_SESSION_ID;
        if (!sessionId) throw new Error("Launch environment did not include MYCLAUDE_SESSION_ID.");

        const terminal = terminalBackend.spawn(command, args, {
          cols: 120,
          cwd: input.cwd,
          env,
          name: "xterm-256color",
          rows: 32,
        });
        const session: TerminalSession = {
          sessionId,
          terminal,
          buffer: "",
          closed: false,
        };
        terminalSessions.set(sessionId, session);

        terminal.onData((data) => {
          session.buffer = trimBuffer(`${session.buffer}${data}`);
          broadcastTerminal({ kind: "data", sessionId, data });
        });

        terminal.onExit(({ exitCode }) => {
          session.closed = true;
          broadcastTerminal({ kind: "exit", sessionId, exitCode });
        });

        void withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
          await client.request("session.start", {
            sessionId,
            pid: terminal.pid,
            authProfileId: input.authProfileId,
          });
        }).catch(() => {
          // The launch path already minted a capability before spawn. This
          // second start only improves liveness metadata for Sessions.
        });

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ sessionId });
        }

        return wrapPtyAsChild(terminal);
      } catch (error) {
        const wrapped = new Error(
          `Failed to start Claude terminal process with "${command}": ${messageForError(error)}`
        );
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(wrapped);
        }
        throw wrapped;
      }
    };

    void runLaunch({
      role: input.role,
      auth: input.authProfileId,
      cwd: input.cwd,
      home: context.myClaudeHome,
      sessionsRoot,
      bare: input.bare ?? false,
      strict: input.strict ?? true,
      passthroughArgs: input.passthroughArgs ?? [],
      callerPid: 0,
      claudeCommand,
      spawnFn,
    }).catch((error) => {
      launchError = error;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  });

  try {
    return await started;
  } catch (error) {
    throw launchError ?? error;
  }
}

export async function resumeNativeClaudeSession(
  input: { sessionId: string; cwd: string },
  _context: LaunchTerminalSessionContext
): Promise<SessionLaunchResult> {
  const terminalBackend = await loadTerminalBackend();
  await assertTerminalBackendReady(terminalBackend);
  const claudeCommand = await resolveClaudeCommand();
  const env = normalizeEnv(process.env);
  let terminal: Pty.IPty;

  try {
    terminal = terminalBackend.spawn(claudeCommand, ["--resume", input.sessionId], {
      cols: 120,
      cwd: input.cwd,
      env,
      name: "xterm-256color",
      rows: 32,
    });
  } catch (error) {
    throw new Error(
      `Failed to resume Claude session "${input.sessionId}" with "${claudeCommand}": ${messageForError(
        error
      )}`
    );
  }

  registerTerminalSession(input.sessionId, terminal);
  return { sessionId: input.sessionId };
}

export function openTerminalSession(sessionId: string): SessionTerminalOpenResult {
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return {
      sessionId,
      attached: false,
      reason: "This session was not launched from the desktop terminal.",
    };
  }
  return {
    sessionId,
    attached: true,
    buffer: session.buffer,
  };
}

export function isTerminalSessionAttachable(sessionId: string): boolean {
  const session = terminalSessions.get(sessionId);
  return Boolean(session && !session.closed);
}

export function writeTerminalSession(sessionId: string, data: string): void {
  const session = terminalSessions.get(sessionId);
  if (!session || session.closed) {
    throw new Error(`Terminal for session "${sessionId}" is not attachable.`);
  }
  session.terminal.write(data);
}

export function resizeTerminalSession(sessionId: string, cols: number, rows: number): void {
  const session = terminalSessions.get(sessionId);
  if (!session || session.closed) return;
  session.terminal.resize(cols, rows);
}

export function closeTerminalSession(sessionId: string): void {
  const session = terminalSessions.get(sessionId);
  if (!session || !session.closed) return;
  terminalSessions.delete(sessionId);
}

function wrapPtyAsChild(terminal: Pty.IPty): ClaudeChildProcess {
  const closeListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  const errorListeners = new Set<(err: Error) => void>();

  terminal.onExit(({ exitCode }) => {
    for (const listener of closeListeners) {
      listener(exitCode, null);
    }
  });

  return {
    kill(signal: NodeJS.Signals): boolean {
      terminal.kill(signal);
      return true;
    },
    on(
      event: "close" | "error",
      listener:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | ((err: Error) => void)
    ) {
      if (event === "close") {
        closeListeners.add(
          listener as (code: number | null, signal: NodeJS.Signals | null) => void
        );
      } else {
        errorListeners.add(listener as (err: Error) => void);
      }
      void errorListeners;
      return this;
    },
  };
}

async function loadTerminalBackend(): Promise<TerminalBackend> {
  terminalBackendPromise ??= import("@homebridge/node-pty-prebuilt-multiarch").then((mod) => ({
    spawn: mod.spawn,
  }));
  return terminalBackendPromise;
}

function assertTerminalBackendReady(backend: TerminalBackend): Promise<void> {
  terminalBackendReadyPromise ??= new Promise((resolve, reject) => {
    let terminal: Pty.IPty;
    try {
      terminal = backend.spawn("/bin/zsh", ["-lc", "true"], {
        cols: 20,
        cwd: process.cwd(),
        env: normalizeEnv(process.env),
        name: "xterm-256color",
        rows: 5,
      });
    } catch (error) {
      reject(
        new Error(
          `Desktop terminal backend failed to start /bin/zsh via PTY: ${messageForError(error)}`
        )
      );
      return;
    }

    const timeout = setTimeout(() => {
      terminal.kill("SIGTERM");
      reject(new Error("Desktop terminal backend self-test timed out."));
    }, 5_000);
    timeout.unref();

    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Desktop terminal backend self-test exited with code ${exitCode}.`));
      }
    });
  });
  return terminalBackendReadyPromise;
}

function registerTerminalSession(sessionId: string, terminal: Pty.IPty): void {
  const session: TerminalSession = {
    sessionId,
    terminal,
    buffer: "",
    closed: false,
  };
  terminalSessions.set(sessionId, session);

  terminal.onData((data) => {
    session.buffer = trimBuffer(`${session.buffer}${data}`);
    broadcastTerminal({ kind: "data", sessionId, data });
  });

  terminal.onExit(({ exitCode }) => {
    session.closed = true;
    broadcastTerminal({ kind: "exit", sessionId, exitCode });
  });
}

function broadcastTerminal(payload: SessionTerminalEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(SESSION_TERMINAL_EVENT_CHANNEL, payload);
  }
}

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") normalized[key] = value;
  }
  return normalized;
}

function trimBuffer(value: string): string {
  if (value.length <= MAX_BUFFER_CHARS) return value;
  return value.slice(value.length - MAX_BUFFER_CHARS);
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

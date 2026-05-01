/**
 * @module preload
 *
 * Renderer ↔ Main bridge.
 *
 * The preload runs in an isolated context (`contextIsolation: true`,
 * `sandbox: true`, `nodeIntegration: false`) and exposes a narrow surface
 * to the Renderer via `contextBridge.exposeInMainWorld`. The Renderer never
 * touches `ipcRenderer` directly; every capability is a function on
 * `window.myclaude`.
 *
 * ## Channel naming convention
 *
 * `category.action`. Examples:
 *
 *   - `system.version`     — read app version
 *   - `auth.list`          — list auth profiles (metadata only)
 *   - `auth.add`           — create a profile (Main collects plaintext)
 *   - `auth.setSecret`     — write a secret (plaintext one-shot)
 *   - `sessions.list`      — read live + recent sessions
 *   - `sessions.kill`      — signal the live PID
 *   - `sessions.onUpdate`  — subscribe to push-event frames
 *
 * The dotted hierarchy keeps related capabilities grep-able and matches the
 * IPC `Req.kind` discriminants used by the daemon protocol.
 *
 * ## Sender-frame validation requirement
 *
 * Every `ipcMain.handle(...)` callback in `src/main/index.ts` MUST call
 * {@link validateSenderFrame} before doing any work. The contextBridge
 * surface is reachable from any frame the Renderer loads; ignoring this
 * check would let a compromised iframe call any channel as if it were the
 * trusted top-level frame.
 *
 * The bridge stays narrow and capability-oriented. Renderer code gets a small
 * method surface; all validation, filesystem access, and daemon transport stay
 * in Main.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("myclaude", {
  system: {
    version: (): Promise<string> => ipcRenderer.invoke("system.version"),
    defaultCwd: (): Promise<string> => ipcRenderer.invoke("system.defaultCwd"),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("system.pickDirectory"),
  },
  auth: {
    list: (): Promise<unknown> => ipcRenderer.invoke("auth.list"),
    /**
     * Create an auth profile. The plaintext Anthropic key is collected by a
     * Main-owned modal child window — Renderer never sees it.
     */
    add: (opts: {
      spec: {
        id: string;
        displayName?: string;
        anthropic: { mode: "apiKey" | "bedrock" | "vertex" | "gateway" | "oauth"; secretRef: string };
        mcpSecretRefs?: Record<string, string>;
      };
      force?: boolean;
    }): Promise<unknown> => ipcRenderer.invoke("auth.add", opts),
    /** Write or update a single MCP secret. Plaintext is a one-shot field. */
    setSecret: (opts: {
      profileId: string;
      name: string;
      value: string;
      register?: boolean;
    }): Promise<unknown> => ipcRenderer.invoke("auth.setSecret", opts),
    /** Replace an existing Anthropic secret. */
    rotate: (opts: { profileId: string; name?: string; value: string }): Promise<unknown> =>
      ipcRenderer.invoke("auth.rotate", opts),
    /** Remove an entire auth profile. Main native confirm guards the path. */
    remove: (opts: { profileId: string; yes?: boolean }): Promise<unknown> =>
      ipcRenderer.invoke("auth.remove", opts),
  },
  oauth: {
    start: (opts: { profileId: string; displayName?: string }): Promise<unknown> =>
      ipcRenderer.invoke("auth.oauth.start", opts),
    refresh: (opts: { authId: string }): Promise<unknown> =>
      ipcRenderer.invoke("auth.oauth.refresh", opts),
    detect: (): Promise<unknown> => ipcRenderer.invoke("auth.oauth.detect"),
  },
  profile: {
    list: (opts: { cwd: string; roleFilter?: string }): Promise<unknown> =>
      ipcRenderer.invoke("profile.list", opts),
    show: (opts: { role: string; authProfileId: string; cwd: string }): Promise<unknown> =>
      ipcRenderer.invoke("profile.show", opts),
    validate: (opts: { content: unknown }): Promise<unknown> =>
      ipcRenderer.invoke("profile.validate", opts),
    preview: (opts: {
      role: string;
      authProfileId: string;
      cwd: string;
      draft: { path: string; content: unknown };
    }): Promise<unknown> => ipcRenderer.invoke("profile.preview", opts),
    save: (opts: { path: string; content: unknown }): Promise<unknown> =>
      ipcRenderer.invoke("profile.save", opts),
  },
  persona: {
    /**
     * Render the persona section (CLAUDE.md + agents/skills/slashCmds/memory)
     * in memory for a `(role, auth, cwd)` triple. Disk is never written —
     * the bridge returns the same shape Renderer would otherwise have to
     * reconstruct from the launch path.
     */
    render: (opts: { role: string; authProfileId: string; cwd: string }): Promise<unknown> =>
      ipcRenderer.invoke("persona.render", opts),
  },
  sessions: {
    list: (): Promise<unknown> => ipcRenderer.invoke("sessions.list"),
    kill: (opts: { sessionId: string; signal?: "SIGTERM" | "SIGKILL" }): Promise<unknown> =>
      ipcRenderer.invoke("sessions.kill", opts),
    relaunch: (opts: { sessionId: string }): Promise<unknown> =>
      ipcRenderer.invoke("sessions.relaunch", opts),
    drift: (opts: { sessionId: string }): Promise<unknown> =>
      ipcRenderer.invoke("sessions.drift", opts),
    /**
     * Subscribe to push-event frames forwarded by Main. The callback receives
     * either `{ kind: "event", event: SessionEvent }` or
     * `{ kind: "connection", state: "up" | "down" }` — the latter lets
     * Renderer trigger a polling fallback when the daemon connection drops.
     * Returns a function that detaches the listener.
     */
    onUpdate: (cb: (payload: unknown) => void): (() => void) => {
      const listener = (_e: unknown, payload: unknown): void => cb(payload);
      ipcRenderer.on("myclaude.sessions.event", listener);
      return () => {
        ipcRenderer.off("myclaude.sessions.event", listener);
      };
    },
  },
});

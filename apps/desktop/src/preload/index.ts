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
 *   - `system.version`   — read app version (this round)
 *   - `auth.list`        — list auth profiles (later)
 *   - `auth.set-secret`  — set a single secret (later)
 *   - `profile.show`     — resolve a `(role, auth, cwd)` triple (later)
 *
 * The dotted hierarchy keeps related capabilities grep-able and matches the
 * IPC `Req.kind` discriminants used by the daemon protocol.
 *
 * ## Sender-frame validation requirement
 *
 * Every `ipcMain.handle(...)` callback in `src/main/index.ts` MUST call
 * {@link validateSenderFrame} (re-exported from `src/main/security.ts`)
 * before doing any work. The `<contextBridge>` surface is reachable from any
 * frame the Renderer loads — including future iframes that load remote
 * content. Ignoring this check would let a compromised iframe call any
 * channel as if it were the trusted top-level frame.
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
  },
  profile: {
    list: (opts: { cwd: string; roleFilter?: string }): Promise<unknown> =>
      ipcRenderer.invoke("profile.list", opts),
    show: (opts: {
      role: string;
      authProfileId: string;
      cwd: string;
    }): Promise<unknown> => ipcRenderer.invoke("profile.show", opts),
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
});

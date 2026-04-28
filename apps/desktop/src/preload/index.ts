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
 * The single channel exposed in this round (`system.version`) demonstrates
 * the pattern; later channels copy the structure verbatim.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("myclaude", {
  /**
   * Return the app's `package.json` version. Backed by `app.getVersion()` in
   * Main; the call goes through `system.version` and validates the sender
   * frame on the Main side.
   */
  version: (): Promise<string> => ipcRenderer.invoke("system.version"),
});

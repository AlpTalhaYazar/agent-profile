/**
 * @module main
 *
 * Electron Main process entry point.
 *
 * Phase 2 Foundation responsibilities (per `docs/08-roadmap.md`):
 *
 *   1. Acquire the per-user single-instance lock via Electron itself (more
 *      reliable than a pidfile).
 *   2. Rotate the boot cookie, compute the socket path, start the IPC daemon.
 *   3. Create a hardened BrowserWindow unless `--headless` /
 *      `MYCLAUDE_HEADLESS=1` was passed (placeholder Renderer this round).
 *   4. Drain the daemon on `before-quit`; remove the lockfile.
 *
 * The Renderer-facing IPC surface is currently `system.version` only; future
 * UI sprints add `auth.*`, `profile.*`, `sessions.*` channels here.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSocketPath } from "@agent-profile/ipc-protocol";
import { BrowserWindow, type IpcMainInvokeEvent, app, ipcMain } from "electron";
import { rotateBootCookie } from "./daemon/cookie.js";
import { DaemonLifecycle } from "./daemon/lifecycle.js";
import { createSecureWindow, validateSenderFrame } from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Vite-injected globals; declared so TypeScript is happy without a vite/client import. */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

const SERVER_VERSION = "0.1.0";

/** Read once at startup; affects whether we create a window. */
function isHeadless(argv: string[] = process.argv, env = process.env): boolean {
  if (env.MYCLAUDE_HEADLESS === "1") return true;
  return argv.includes("--headless");
}

/** Resolve the renderer entry URL for sender-frame validation + window load. */
function rendererEntryUrl(): string {
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  }
  // Forge plugin-vite emits per-renderer dirs under `.vite/renderer/<name>/`.
  const name = typeof MAIN_WINDOW_VITE_NAME !== "undefined" ? MAIN_WINDOW_VITE_NAME : "main_window";
  const filePath = join(__dirname, "..", "renderer", name, "index.html");
  return `file://${filePath}`;
}

const lifecycle = new DaemonLifecycle();

async function startup(): Promise<void> {
  // Per-user single-instance lock. If another Main is already running, exit 0
  // — the existing one is the canonical daemon for this user.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  await app.whenReady();

  const cookie = await rotateBootCookie();
  const socketPath = defaultSocketPath();
  await lifecycle.start({
    socketPath,
    cookie,
    serverVersion: SERVER_VERSION,
    requestShutdown: () => app.quit(),
  });

  // Renderer-facing IPC surface (preload-only; Renderer reaches it via
  // `contextBridge.exposeInMainWorld('myclaude', { version })`).
  const expectedFrameUrl = rendererEntryUrl();
  ipcMain.handle("system.version", (event: IpcMainInvokeEvent) => {
    if (!validateSenderFrame(event, expectedFrameUrl)) {
      throw new Error("system.version: sender frame mismatch");
    }
    return app.getVersion();
  });

  if (isHeadless()) {
    // Headless: keep the Main process alive, daemon is serving requests, no
    // window will be created. `myclaude daemon stop` triggers shutdown via
    // the IPC handler -> lifecycle.requestShutdown -> app.quit.
    return;
  }

  // GUI mode: open the placeholder window. Real screens land in later sprints.
  const preloadPath = join(__dirname, "preload.cjs");
  const win = createSecureWindow({ preloadPath, show: true }, BrowserWindow);
  await win.loadURL(rendererEntryUrl());
}

// Drain on every quit path so tests / dev cycles don't leave UDS files behind.
app.on("before-quit", (event) => {
  if (lifecycle.isShutdownRequested()) return;
  event.preventDefault();
  void lifecycle.drainAndClose().finally(() => {
    // Re-issue quit; the second pass returns early because the flag is set.
    app.exit(0);
  });
});

// Don't quit on `window-all-closed` while the daemon is still running. Headless
// callers never opened a window, and GUI users may want the daemon to outlive
// the main window so subsequent CLI invocations can still reach it.
app.on("window-all-closed", () => {
  // intentionally no-op
});

void startup().catch((err) => {
  // Surface to stderr so Forge's start command shows the failure prominently.
  process.stderr.write(`[agent-profile/desktop] startup failed: ${String(err)}\n`);
  app.exit(1);
});

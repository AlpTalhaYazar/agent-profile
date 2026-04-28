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
 * The Renderer-facing IPC surface is a narrow `window.myclaude` bridge for
 * read-only profile/auth flows plus `profile.save`.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type DaemonClient,
  type RespAuthListOkT,
  type RespProfileListOkT,
  type RespProfilePreviewOkT,
  type RespProfileSaveOkT,
  type RespProfileShowOkT,
  type RespProfileValidateOkT,
  connectToSocket,
  defaultSocketPath,
  readCookie,
} from "@agent-profile/ipc-protocol";
import { getBackend } from "@agent-profile/secrets";
import { BrowserWindow, app, dialog, ipcMain, safeStorage } from "electron";
import { z } from "zod";
import { AuditLog } from "./daemon/audit.js";
import { buildCapabilityRegistry } from "./daemon/capability-registry.js";
import { rotateBootCookie } from "./daemon/cookie.js";
import { DaemonLifecycle } from "./daemon/lifecycle.js";
import { buildSecretsStore } from "./daemon/secrets-store.js";
import { assertValidSenderFrame, createSecureWindow, parseRendererPayload } from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Vite-injected globals; declared so TypeScript is happy without a vite/client import. */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

const SERVER_VERSION = "0.1.0";
const STARTUP_CWD = process.cwd();
const NoPayload = z.undefined();
const AuthListPayload = NoPayload;
const ProfileListPayload = z
  .object({
    cwd: z.string().min(1),
    roleFilter: z.string().min(1).optional(),
  })
  .strict();
const ProfileShowPayload = z
  .object({
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();
const ProfileValidatePayload = z.object({ content: z.unknown() }).strict();
const ProfilePreviewPayload = z
  .object({
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
    draft: z
      .object({
        path: z.string().min(1),
        content: z.unknown(),
      })
      .strict(),
  })
  .strict();
const ProfileSavePayload = z
  .object({
    path: z.string().min(1),
    content: z.unknown(),
  })
  .strict();

/** Read once at startup; affects whether we create a window. */
function isHeadless(argv: string[] = process.argv, env = process.env): boolean {
  if (env.MYCLAUDE_HEADLESS === "1") return true;
  return argv.includes("--headless");
}

interface RendererEntryUrlOpts {
  devServerUrl?: string;
  rendererName?: string;
  baseDir?: string;
}

/** Resolve the renderer entry URL for sender-frame validation + window load. */
export function rendererEntryUrl(opts: RendererEntryUrlOpts = {}): string {
  const injectedDevServerUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined"
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;
  const devServerUrl = opts.devServerUrl ?? injectedDevServerUrl;
  if (devServerUrl) {
    const baseUrl = devServerUrl.endsWith("/") ? devServerUrl : `${devServerUrl}/`;
    return new URL("src/renderer/index.html", baseUrl).toString();
  }

  // Forge plugin-vite emits per-renderer dirs under `.vite/renderer/<name>/`.
  const injectedRendererName =
    typeof MAIN_WINDOW_VITE_NAME !== "undefined" ? MAIN_WINDOW_VITE_NAME : undefined;
  const name = opts.rendererName ?? injectedRendererName ?? "main_window";
  const baseDir = opts.baseDir ?? __dirname;
  const filePath = join(baseDir, "..", "renderer", name, "src", "renderer", "index.html");
  return pathToFileURL(filePath).toString();
}

/** Resolve the preload bundle path across Forge/Vite output variants. */
function preloadEntryPath(): string {
  const namedPath = join(__dirname, "preload.cjs");
  if (existsSync(namedPath)) return namedPath;
  return join(__dirname, "index.js");
}

const lifecycle = new DaemonLifecycle();

async function withDaemonClient<T>(
  myClaudeHome: string,
  clientVersion: string,
  run: (client: DaemonClient) => Promise<T>
): Promise<T> {
  const cookie = await readCookie(myClaudeHome);
  const client = await connectToSocket({
    socketPath: defaultSocketPath(),
    clientVersion,
    cookie,
  });
  try {
    return await run(client);
  } finally {
    client.close();
  }
}

export function registerRendererIpcHandlers(opts: {
  expectedFrameUrl: string;
  myClaudeHome: string;
  startupCwd?: string;
}): void {
  const { expectedFrameUrl, myClaudeHome, startupCwd = STARTUP_CWD } = opts;

  ipcMain.handle("system.version", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "system.version");
    parseRendererPayload(NoPayload, payload, "system.version");
    return app.getVersion();
  });

  ipcMain.handle("system.defaultCwd", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "system.defaultCwd");
    parseRendererPayload(NoPayload, payload, "system.defaultCwd");
    return startupCwd;
  });

  ipcMain.handle("system.pickDirectory", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "system.pickDirectory");
    parseRendererPayload(NoPayload, payload, "system.pickDirectory");
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: { properties: Array<"openDirectory"> } = {
      properties: ["openDirectory"],
    };
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("auth.list", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "auth.list");
    parseRendererPayload(AuthListPayload, payload, "auth.list");
    return withDaemonClient(myClaudeHome, app.getVersion(), async (client) => {
      const resp = await client.request<RespAuthListOkT>("auth.list", {});
      return { profiles: resp.profiles };
    });
  });

  ipcMain.handle("profile.list", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "profile.list");
    const parsed = parseRendererPayload(ProfileListPayload, payload, "profile.list");
    return withDaemonClient(myClaudeHome, app.getVersion(), async (client) => {
      const resp = await client.request<RespProfileListOkT>("profile.list", parsed);
      return { scopes: resp.scopes };
    });
  });

  ipcMain.handle("profile.show", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "profile.show");
    const parsed = parseRendererPayload(ProfileShowPayload, payload, "profile.show");
    return withDaemonClient(myClaudeHome, app.getVersion(), async (client) => {
      const resp = await client.request<RespProfileShowOkT>("profile.show", parsed);
      return { effective: resp.effective, provenance: resp.provenance };
    });
  });

  ipcMain.handle("profile.validate", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "profile.validate");
    const parsed = parseRendererPayload(ProfileValidatePayload, payload, "profile.validate");
    return withDaemonClient(myClaudeHome, app.getVersion(), async (client) => {
      const resp = await client.request<RespProfileValidateOkT>("profile.validate", parsed);
      return { issues: resp.issues };
    });
  });

  ipcMain.handle("profile.preview", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "profile.preview");
    const parsed = parseRendererPayload(ProfilePreviewPayload, payload, "profile.preview");
    return withDaemonClient(myClaudeHome, app.getVersion(), async (client) => {
      const resp = await client.request<RespProfilePreviewOkT>("profile.preview", parsed);
      return {
        issues: resp.issues,
        current: resp.current,
        preview: resp.preview,
        diff: resp.diff,
      };
    });
  });

  ipcMain.handle("profile.save", async (event, payload) => {
    assertValidSenderFrame(event, expectedFrameUrl, "profile.save");
    const parsed = parseRendererPayload(ProfileSavePayload, payload, "profile.save");
    return withDaemonClient(myClaudeHome, app.getVersion(), async (client) => {
      const resp = await client.request<RespProfileSaveOkT>("profile.save", parsed);
      return { saved: resp.saved, path: resp.path };
    });
  });
}

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

  const myClaudeHome = process.env.MYCLAUDE_HOME ?? join(homedir(), ".myclaude");
  const store = await buildSecretsStore({ myClaudeHome, safeStorage });
  const capability = buildCapabilityRegistry();
  const audit = new AuditLog({ filePath: join(myClaudeHome, "audit.log") });
  const keyring = await getBackend().catch(() => undefined);

  await lifecycle.start({
    socketPath,
    cookie,
    serverVersion: SERVER_VERSION,
    requestShutdown: () => app.quit(),
    writeHandlers: {
      myClaudeHome,
      store,
      ...(keyring ? { keyring } : {}),
      issuer: capability.issuer,
      verifier: capability.verifier,
      audit,
      daemonPid: process.pid,
    },
  });

  const expectedFrameUrl = rendererEntryUrl();
  registerRendererIpcHandlers({ expectedFrameUrl, myClaudeHome, startupCwd: STARTUP_CWD });

  if (isHeadless()) {
    // Headless: keep the Main process alive, daemon is serving requests, no
    // window will be created. `myclaude daemon stop` triggers shutdown via
    // the IPC handler -> lifecycle.requestShutdown -> app.quit.
    return;
  }

  // GUI mode: open the placeholder window. Real screens land in later sprints.
  const preloadPath = preloadEntryPath();
  const win = createSecureWindow({ preloadPath }, BrowserWindow);
  win.once("ready-to-show", () => {
    win.show();
  });
  await win.loadURL(expectedFrameUrl);
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

if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  void startup().catch((err) => {
    // Surface to stderr so Forge's start command shows the failure prominently.
    process.stderr.write(`[agent-profile/desktop] startup failed: ${String(err)}\n`);
    app.exit(1);
  });
}

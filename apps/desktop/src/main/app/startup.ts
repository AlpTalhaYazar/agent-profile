import { join } from "node:path";
import { defaultSocketPath } from "@agent-profile/ipc-protocol";
import { getBackend } from "@agent-profile/secrets";
import { BrowserWindow, app, safeStorage } from "electron";
import { AuditLog } from "../daemon/audit.js";
import { buildCapabilityRegistry } from "../daemon/capability-registry.js";
import { rotateBootCookie } from "../daemon/cookie.js";
import { type DaemonEventClient, startDaemonEventClient } from "../daemon/events.js";
import type { DaemonLifecycle } from "../daemon/lifecycle.js";
import { buildSecretsStore } from "../daemon/secrets-store.js";
import { registerRendererIpcHandlers } from "../ipc/register.js";
import { createSecureWindow } from "../security.js";
import { preloadEntryPath, rendererEntryUrl } from "../window/entry.js";
import { SERVER_VERSION, STARTUP_CWD, isHeadless, resolveMyClaudeHome } from "./environment.js";

export interface StartupOptions {
  lifecycle: DaemonLifecycle;
}

export interface StartupResult {
  eventClient?: DaemonEventClient;
}

export async function startup(opts: StartupOptions): Promise<StartupResult> {
  const { lifecycle } = opts;

  // Per-user single-instance lock. If another Main is already running, exit 0
  // because the existing one is the canonical daemon for this user.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return {};
  }

  await app.whenReady();

  const cookie = await rotateBootCookie();
  const socketPath = defaultSocketPath();
  const myClaudeHome = resolveMyClaudeHome();
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

  const clientVersion = app.getVersion();
  const expectedFrameUrl = rendererEntryUrl();
  registerRendererIpcHandlers({
    expectedFrameUrl,
    myClaudeHome,
    startupCwd: STARTUP_CWD,
    clientVersion,
    store,
  });

  let eventClient: DaemonEventClient | undefined;
  try {
    eventClient = await startDaemonEventClient(myClaudeHome, clientVersion);
  } catch {
    // Non-fatal; Renderer hooks fall back to polling after a down notice.
  }

  if (isHeadless()) {
    return eventClient ? { eventClient } : {};
  }

  const preloadPath = preloadEntryPath();
  const win = createSecureWindow({ preloadPath }, BrowserWindow);
  win.once("ready-to-show", () => {
    win.show();
  });
  await win.loadURL(expectedFrameUrl);

  return eventClient ? { eventClient } : {};
}

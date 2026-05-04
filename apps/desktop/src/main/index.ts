/**
 * @module main
 *
 * Electron Main process entry point. Composition and domain work live in
 * focused modules under `main/app`, `main/ipc`, `main/window`, and
 * `main/daemon`.
 */

import { app } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { startup } from "./app/startup.js";
import { type DaemonEventClient, stopDaemonEventClient } from "./daemon/events.js";
import { DaemonLifecycle } from "./daemon/lifecycle.js";

const lifecycle = new DaemonLifecycle();
let eventClient: DaemonEventClient | null = null;
let draining = false;

app.on("before-quit", (event) => {
  if (draining) return;
  draining = true;
  event.preventDefault();
  if (eventClient) {
    stopDaemonEventClient(eventClient);
    eventClient = null;
  }
  void lifecycle.drainAndClose().finally(() => {
    app.exit(0);
  });
});

// Don't quit on `window-all-closed` while the daemon is still running. Headless
// callers never opened a window, and GUI users may want the daemon to outlive
// the main window so subsequent CLI invocations can still reach it.
app.on("window-all-closed", () => {
  // intentionally no-op
});

if (squirrelStartup) {
  app.quit();
} else if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  void startup({ lifecycle })
    .then((result) => {
      eventClient = result.eventClient ?? null;
    })
    .catch((err) => {
      process.stderr.write(`[agent-profile/desktop] startup failed: ${String(err)}\n`);
      app.exit(1);
    });
}

/**
 * @module main/native-secret-dialog
 *
 * Main-process modal child window that collects a single plaintext secret.
 *
 * Phase 2 milestone 5 hybrid plaintext flow: `auth.add` opens this dialog so
 * the Anthropic API key the user types never crosses the Renderer. The window
 * loads a `data:` URL with a dedicated preload (registered in
 * `forge.config.ts` under `src/secret-dialog/preload.ts`) that exposes only
 * `secretDialog.submit(value)` / `secretDialog.cancel()` — no other API.
 *
 * The collected plaintext lives in the Main process for the lifetime of the
 * Promise this module returns and is forwarded directly to the daemon by the
 * caller; this module never logs or persists it.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, type IpcMainEvent, ipcMain } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** HTML rendered inside the modal child window. Loaded via `data:` URL. */
function renderDialogHtml(opts: { title: string; label: string }): string {
  const escapeHtml = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 0;
    padding: 24px;
    background: #fff;
    color: #111;
    font-size: 14px;
  }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p.hint { margin: 0 0 16px; color: #555; font-size: 13px; }
  label { display: block; margin: 0 0 6px; font-weight: 500; }
  input {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #c9c9c9;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
  }
  input:focus { outline: 2px solid #2563eb; outline-offset: -1px; }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  button {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid #c9c9c9;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: #111;
    color: #fff;
    border-color: #111;
  }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
</style>
</head>
<body>
<h1>${escapeHtml(opts.title)}</h1>
<p class="hint">This value stays in the desktop app and is never read by the renderer.</p>
<form id="form">
  <label for="secret">${escapeHtml(opts.label)}</label>
  <input id="secret" type="password" autocomplete="off" autofocus />
  <div class="actions">
    <button type="button" id="cancel">Cancel</button>
    <button type="submit" class="primary" id="save">Save</button>
  </div>
</form>
<script>
(function () {
  const form = document.getElementById("form");
  const input = document.getElementById("secret");
  const cancel = document.getElementById("cancel");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const value = input.value;
    input.value = "";
    window.secretDialog.submit(value);
  });
  cancel.addEventListener("click", () => {
    input.value = "";
    window.secretDialog.cancel();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      input.value = "";
      window.secretDialog.cancel();
    }
  });
})();
</script>
</body>
</html>`;
}

/** Resolve the secret-dialog preload bundle path emitted by Forge plugin-vite. */
function resolvePreloadPath(): string {
  // Forge plugin-vite emits each preload entry under the main bundle's dir.
  // Two output names are possible depending on Forge version: the entry's
  // basename (`preload.cjs`) or the bundle's id. We probe the most common
  // names used in the existing main preload helper.
  const candidates = [
    join(__dirname, "secret-dialog-preload.cjs"),
    join(__dirname, "secret-dialog-preload.js"),
    join(__dirname, "preload-1.cjs"),
    join(__dirname, "preload-1.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Dev fallback: the source path. Forge's vite dev mode resolves this.
  return join(__dirname, "..", "secret-dialog", "preload.js");
}

let nextRequestId = 0;

export interface RequestSecretInputOptions {
  parent: BrowserWindow | null;
  title: string;
  label: string;
}

/**
 * Open a modal child window asking the user for a single secret value.
 *
 * Resolves with the plaintext on Save, with `null` on Cancel / Escape /
 * window-close. The plaintext is in Main process memory only for the
 * Promise's lifetime; the caller is expected to forward it to the daemon and
 * let the local variable go out of scope.
 */
export async function requestSecretInputViaMain(
  opts: RequestSecretInputOptions
): Promise<string | null> {
  const requestId = `${process.pid}-${++nextRequestId}`;
  const submitChannel = `secret-dialog:submit:${requestId}`;
  const cancelChannel = `secret-dialog:cancel:${requestId}`;
  const fallbackSubmitChannel = "secret-dialog:submit:";
  const fallbackCancelChannel = "secret-dialog:cancel:";
  const html = renderDialogHtml({ title: opts.title, label: opts.label });
  // Append the requestId in the URL fragment and as an Electron additional
  // argument. The preload accepts both so this remains stable across data URL
  // parsing differences.
  const dataUrlWithParams = `data:text/html;charset=utf-8,${encodeURIComponent(html)}#requestId=${encodeURIComponent(requestId)}`;

  return new Promise<string | null>((resolve) => {
    const win = new BrowserWindow({
      ...(opts.parent ? { parent: opts.parent } : {}),
      modal: true,
      width: 480,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: opts.title,
      webPreferences: {
        additionalArguments: [`--secret-request-id=${requestId}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: resolvePreloadPath(),
        // Only this window's BrowserWindow may message back; we still validate
        // sender below.
      },
    });

    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeAllListeners(submitChannel);
      ipcMain.removeAllListeners(cancelChannel);
      ipcMain.removeListener(fallbackSubmitChannel, handleSubmit);
      ipcMain.removeListener(fallbackCancelChannel, handleCancel);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };

    const handleSubmit = (event: IpcMainEvent, value: unknown): void => {
      // Only accept submissions from the dialog's own webContents.
      if (event.sender !== win.webContents) return;
      settle(typeof value === "string" ? value : null);
    };
    const handleCancel = (event: IpcMainEvent): void => {
      if (event.sender !== win.webContents) return;
      settle(null);
    };

    ipcMain.once(submitChannel, handleSubmit);
    ipcMain.once(cancelChannel, handleCancel);
    ipcMain.on(fallbackSubmitChannel, handleSubmit);
    ipcMain.on(fallbackCancelChannel, handleCancel);

    win.on("closed", () => {
      settle(null);
    });

    win.loadURL(dataUrlWithParams).catch(() => {
      settle(null);
    });
  });
}

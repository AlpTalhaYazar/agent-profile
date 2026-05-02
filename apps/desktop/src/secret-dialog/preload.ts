/**
 * @module secret-dialog/preload
 *
 * Preload bundle for the Main-owned secret-entry child window.
 *
 * The Main process opens this modal to collect plaintext for `auth.add` so the
 * value never travels through the Renderer. The window has its own data URL
 * HTML (assembled in `main/native-secret-dialog.ts`); this preload exposes
 * exactly two methods:
 *
 *  - `secretDialog.submit(value)` — forwards the plaintext to Main on the
 *    request-id channel and signals success.
 *  - `secretDialog.cancel()` — signals user cancellation.
 *
 * No other API is exposed. The window has no Node integration and no other
 * preload surface.
 */

import { contextBridge, ipcRenderer } from "electron";

const searchParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const argvRequestId =
  process.argv
    .find((arg) => arg.startsWith("--secret-request-id="))
    ?.slice("--secret-request-id=".length) ?? null;
const requestId =
  argvRequestId ?? searchParams.get("requestId") ?? hashParams.get("requestId") ?? "";

interface SecretDialogBridge {
  submit(value: string): void;
  cancel(): void;
}

const bridge: SecretDialogBridge = {
  submit(value: string): void {
    ipcRenderer.send(`secret-dialog:submit:${requestId}`, value);
    if (requestId) {
      ipcRenderer.send("secret-dialog:submit:", value);
    }
  },
  cancel(): void {
    ipcRenderer.send(`secret-dialog:cancel:${requestId}`);
    if (requestId) {
      ipcRenderer.send("secret-dialog:cancel:");
    }
  },
};

contextBridge.exposeInMainWorld("secretDialog", bridge);

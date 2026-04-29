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

const params = new URLSearchParams(window.location.search);
const requestId = params.get("requestId") ?? "";

interface SecretDialogBridge {
  submit(value: string): void;
  cancel(): void;
}

const bridge: SecretDialogBridge = {
  submit(value: string): void {
    ipcRenderer.send(`secret-dialog:submit:${requestId}`, value);
  },
  cancel(): void {
    ipcRenderer.send(`secret-dialog:cancel:${requestId}`);
  },
};

contextBridge.exposeInMainWorld("secretDialog", bridge);

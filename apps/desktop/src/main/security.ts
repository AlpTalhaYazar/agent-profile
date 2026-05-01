/**
 * @module security
 *
 * Renderer-hardening invariants for the desktop app.
 *
 * Every BrowserWindow created by the app MUST go through {@link createSecureWindow}.
 * `assertHardening` is called immediately after construction so that any future
 * change which accidentally relaxes one of the invariants — by passing custom
 * `webPreferences`, by mutating Forge templates, or by hand-rolling a
 * `BrowserWindow` somewhere else in the codebase — fails loudly at startup
 * rather than silently weakening the security posture.
 *
 * Sender-frame validation
 * -----------------------
 *
 * Channels exposed via `contextBridge` are reachable from any frame the
 * Renderer loads — including future iframes that load remote content. Every
 * `ipcMain.handle` callback should call {@link validateSenderFrame} with the
 * expected app URL before doing any work; a mismatch means the request did not
 * originate in our trusted entry document and must be rejected.
 *
 * Channel naming
 * --------------
 *
 * Use `category.action` as the channel name (`system.version`,
 * `auth.list`, …). The Renderer-facing surface in `preload/index.ts` mirrors
 * the same dotted hierarchy, which keeps each capability discoverable in
 * grep / search and makes it trivial to enumerate which channels exist.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMainInvokeEvent } from "electron";
import type { ZodType } from "zod";

/** Options accepted by {@link createSecureWindow}. */
export interface CreateSecureWindowOpts {
  /** Absolute path to the compiled preload bundle (`.vite/build/preload.cjs`). */
  preloadPath: string;
  /** Optional initial dimensions; defaults to a sensible 1280x800. */
  width?: number;
  height?: number;
  /** When true, the window is shown immediately. Defaults to false (caller decides). */
  show?: boolean;
}

/**
 * BrowserWindow constructor type narrowed to the bits this module touches.
 *
 * The factory accepts an injectable constructor so unit tests can verify the
 * options we pass through without spinning up a real Electron runtime.
 */
export type BrowserWindowCtor = new (opts?: BrowserWindowConstructorOptions) => BrowserWindow;

/**
 * The webPreferences shape `assertHardening` validates. Mirrors the relevant
 * subset of `Electron.WebPreferences`.
 */
export interface HardenedWebPreferences {
  contextIsolation?: boolean;
  nodeIntegration?: boolean;
  sandbox?: boolean;
  webSecurity?: boolean;
  preload?: string;
}

/**
 * Construct a hardened {@link BrowserWindow}.
 *
 * Invariants enforced (and re-checked by {@link assertHardening}):
 *
 *   - `contextIsolation: true`     — Renderer cannot access Main's globals.
 *   - `nodeIntegration: false`     — `require`, `process`, etc. unavailable.
 *   - `sandbox: true`              — Chromium OS-level sandbox enabled.
 *   - `webSecurity: true`          — same-origin policy stays on.
 *   - `preload`: provided path     — only the explicit preload bundle loads.
 *
 * Refusing to expose any options that could relax these — callers cannot pass
 * `webPreferences` directly. If you need a different invariant, change it here
 * after consulting `docs/06-security.md`.
 *
 * The hardening assertion runs **before** the BrowserWindow is constructed
 * against the prefs object we are about to pass in. This is the strongest
 * point at which we can assert invariants without depending on private
 * Electron APIs (Electron does not expose a public `webContents.getWebPreferences`).
 */
export function createSecureWindow(
  opts: CreateSecureWindowOpts,
  Ctor: BrowserWindowCtor
): BrowserWindow {
  const webPreferences: HardenedWebPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: opts.preloadPath,
  };
  assertHardening({ webPreferences });
  return new Ctor({
    width: opts.width ?? 1280,
    height: opts.height ?? 800,
    minWidth: 720,
    minHeight: 500,
    show: opts.show ?? false,
    center: true,
    titleBarStyle: "hiddenInset",
    webPreferences,
  });
}

/**
 * Object shape accepted by {@link assertHardening}.
 *
 * In production we always pass the prefs we just computed inside
 * {@link createSecureWindow}. In tests we synthesize the shape directly so we
 * can exercise both the happy path and every violation branch without an
 * Electron runtime.
 */
export interface HardeningInspectable {
  webPreferences: HardenedWebPreferences | undefined;
}

/**
 * Throw if any hardening invariant is missing on the supplied
 * `webPreferences`. Called from {@link createSecureWindow} immediately before
 * construction.
 *
 * Exported so tests (and any future custom window factories that bypass the
 * factory above for legitimate reasons — e.g. a hidden persistence window)
 * can still gate themselves on the same invariants.
 *
 * @throws {Error} when any of the four hardening flags is not strictly the
 *   expected value.
 */
export function assertHardening(window: HardeningInspectable): void {
  const prefs = window.webPreferences;
  if (!prefs) {
    throw new Error("security.assertHardening: webPreferences is undefined");
  }
  const violations: string[] = [];
  if (prefs.contextIsolation !== true) violations.push("contextIsolation must be true");
  if (prefs.nodeIntegration !== false) violations.push("nodeIntegration must be false");
  if (prefs.sandbox !== true) violations.push("sandbox must be true");
  if (prefs.webSecurity !== true) violations.push("webSecurity must be true");
  if (typeof prefs.preload !== "string" || prefs.preload.length === 0) {
    violations.push("preload path must be set");
  }
  if (violations.length > 0) {
    throw new Error(`security.assertHardening: window failed invariants: ${violations.join("; ")}`);
  }
}

/**
 * Sender-frame validation for `ipcMain.handle(...)` callbacks.
 *
 * Called from every IPC handler that surfaces capability to the Renderer.
 * Compares `event.senderFrame.url` against the expected entry URL; if the
 * request originated in a frame whose URL does not match, the handler returns
 * `false` (i.e. "reject and respond with an error to the caller").
 *
 * The expected URL is supplied by the caller because it differs between dev
 * (vite-served URL) and prod (file:// asar path); Main is the only place that
 * knows which one it loaded.
 *
 * Pattern:
 * ```ts
 * ipcMain.handle("system.version", (event) => {
 *   if (!validateSenderFrame(event, expectedRendererUrl)) {
 *     throw new Error("rejected: sender frame mismatch");
 *   }
 *   return app.getVersion();
 * });
 * ```
 */
export function validateSenderFrame(event: IpcMainInvokeEvent, expectedUrl: string): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  return frame.url === expectedUrl;
}

/** Throw when a renderer IPC call does not originate from the trusted frame. */
export function assertValidSenderFrame(
  event: IpcMainInvokeEvent,
  expectedUrl: string,
  channel: string
): void {
  if (!validateSenderFrame(event, expectedUrl)) {
    throw new Error(`${channel}: sender frame mismatch`);
  }
}

/** Parse and validate a renderer IPC payload with a channel-specific error prefix. */
export function parseRendererPayload<T>(schema: ZodType<T>, payload: unknown, channel: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `${channel}: invalid payload${issue ? ` at ${issue.path.join(".") || "(root)"}: ${issue.message}` : ""}`
    );
  }
  return result.data;
}

/**
 * Backend auto-detection.
 *
 * Determines which keychain backend is available on the current platform and
 * returns a configured `Backend` instance.
 *
 * Detection strategy:
 * 1. macOS   → always `keychain-macos`
 * 2. Windows → always `credential-manager`
 * 3. Linux   → probe `@napi-rs/keyring` to discover libsecret / kwallet /
 *              basic-text / unavailable
 *
 * We probe by attempting a benign read of a known dummy key. If `@napi-rs/keyring`
 * loads without throwing (i.e., the native module is present and the OS keychain
 * daemon responded), we inspect the error message to classify the backend.
 */

import { KeyringBackend } from "./keyring.js";
import type { Backend, KeychainBackend } from "./types.js";

let _cachedBackend: Backend | null = null;

/**
 * Returns the detected `Backend` for the current platform.
 *
 * The result is cached after the first call; subsequent calls return the
 * same instance. Pass `forceRefresh: true` to bypass the cache (test use only).
 *
 * @param forceRefresh - If `true`, re-detect and replace the cached instance.
 */
export async function getBackend(forceRefresh = false): Promise<Backend> {
  if (_cachedBackend && !forceRefresh) {
    return _cachedBackend;
  }

  const kind = await detectKind();
  _cachedBackend = new KeyringBackend(kind);
  return _cachedBackend;
}

/**
 * Returns `true` if the given backend kind is considered secure.
 *
 * `basic-text` and `unavailable` are not secure.
 */
export function isBackendSecure(backend: Backend): boolean {
  return backend.isSecure();
}

/**
 * Detects the keychain backend kind for the current platform.
 *
 * This function performs a probe read to determine whether the native keychain
 * daemon is running and which backend it uses.
 *
 * @internal
 */
async function detectKind(): Promise<KeychainBackend> {
  const platform = process.platform;

  if (platform === "darwin") {
    return "keychain-macos";
  }

  if (platform === "win32") {
    return "credential-manager";
  }

  // Linux: probe @napi-rs/keyring to determine which backend is in use.
  return await detectLinuxBackend();
}

/**
 * Probes the keychain on Linux to determine which backend is active.
 *
 * We attempt a read of a dummy key and inspect the error message.
 * This is the only cross-platform way to detect the backend at runtime
 * without spawning additional processes.
 */
async function detectLinuxBackend(): Promise<KeychainBackend> {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    // Use a dummy key that doesn't exist; we only care about the error type.
    const probe = new AsyncEntry("agent-profile-probe", "__detect__");
    try {
      await probe.getPassword();
      // If we got here without error, the keychain responded.
      // We can't determine the specific backend from a successful read,
      // so default to libsecret (most common on GNOME).
      return "libsecret";
    } catch (err) {
      return classifyLinuxError(err);
    }
  } catch {
    // Native module failed to load entirely.
    return "unavailable";
  }
}

/**
 * Classifies a Linux keychain error into a `KeychainBackend` kind.
 *
 * We inspect error messages from the `keyring-rs` library to determine
 * the underlying backend. Message strings are stable across keyring-rs
 * versions for the purposes of this classification.
 *
 * @internal Exported for testing only.
 */
export function classifyLinuxError(err: unknown): KeychainBackend {
  if (!(err instanceof Error)) return "unavailable";

  const msg = err.message.toLowerCase();

  // "No entry" means the keychain is reachable but the key doesn't exist.
  // This is a healthy probe result — keychain is available.
  if (msg.includes("no entry") || msg.includes("no such credential") || msg.includes("not found")) {
    // Still need to determine whether it's libsecret or kwallet.
    // Attempt a secondary classification based on environment.
    return detectLinuxDesktop();
  }

  // kwallet-specific error messages
  if (msg.includes("kwallet") || msg.includes("org.kde.kwalletd")) {
    return "kwallet";
  }

  // libsecret / GNOME keyring errors
  if (
    msg.includes("secret service") ||
    msg.includes("org.freedesktop.secrets") ||
    msg.includes("gnome-keyring") ||
    msg.includes("libsecret")
  ) {
    return "libsecret";
  }

  // basic_text fallback: keyring-rs explicitly identifies this in its error
  if (msg.includes("basic") || msg.includes("plaintext") || msg.includes("file")) {
    return "basic-text";
  }

  // Daemon not running, locked, or unavailable
  if (
    msg.includes("unavailable") ||
    msg.includes("locked") ||
    msg.includes("connection refused") ||
    msg.includes("no such file")
  ) {
    return "unavailable";
  }

  // Unknown error — treat as unavailable to be safe.
  return "unavailable";
}

/**
 * Inspects the desktop environment to distinguish libsecret from kwallet.
 * Used when the keychain is reachable (probe returned "no entry") but we
 * can't distinguish backends from the error message alone.
 *
 * @internal Exported for testing only.
 */
export function detectLinuxDesktop(): KeychainBackend {
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
  const session = (process.env.DESKTOP_SESSION ?? "").toLowerCase();

  if (desktop.includes("kde") || session.includes("kde") || session.includes("plasma")) {
    return "kwallet";
  }

  // Default to libsecret for GNOME, XFCE, and other DE's
  return "libsecret";
}

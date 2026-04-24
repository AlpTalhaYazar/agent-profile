/**
 * `@napi-rs/keyring` adapter implementing the `Backend` interface.
 *
 * This is the CLI-standalone credential backend. It uses Rust's `keyring-rs`
 * crate (via N-API bindings) with prebuilt binaries for macOS, Windows, and
 * Linux (x64, arm64, musl). No `node-gyp` required.
 *
 * The `service` concept from `@napi-rs/keyring` is repurposed as follows:
 * - We store all credentials under a single agent-profile service name so that
 *   `findCredentials` can enumerate them.
 * - The `account` (username in keyring parlance) holds the full namespaced key
 *   (e.g. `"agent-profile.anthropic.work"`).
 *
 * Phase 2 will add a `safeStorage`-backed implementation behind the same
 * `Backend` interface without any changes to consumers.
 */

import { AsyncEntry, findCredentialsAsync } from "@napi-rs/keyring";
import { KEY_PREFIX } from "../namespace.js";
import type { Backend, KeychainBackend } from "./types.js";

/** The keyring service name used for all agent-profile entries. */
const KEYRING_SERVICE = KEY_PREFIX;

/**
 * `@napi-rs/keyring`-backed implementation of the `Backend` interface.
 *
 * Instantiate once and pass to CRUD functions via dependency injection.
 * In production, use `getBackend()` which auto-detects the platform.
 */
export class KeyringBackend implements Backend {
  readonly kind: KeychainBackend;

  constructor(kind: KeychainBackend) {
    this.kind = kind;
  }

  isSecure(): boolean {
    return this.kind !== "basic-text" && this.kind !== "unavailable";
  }

  async get(key: string): Promise<string | null> {
    const entry = new AsyncEntry(KEYRING_SERVICE, key);
    try {
      const value = await entry.getPassword();
      return value ?? null;
    } catch (err) {
      // keyring-rs throws a "NoEntry" error when the credential doesn't exist.
      // We normalize that to null; all other errors bubble up.
      if (isNoEntryError(err)) return null;
      throw err;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const entry = new AsyncEntry(KEYRING_SERVICE, key);
    await entry.setPassword(value);
  }

  async remove(key: string): Promise<void> {
    const entry = new AsyncEntry(KEYRING_SERVICE, key);
    try {
      await entry.deleteCredential();
    } catch (err) {
      // Removing a non-existent key is a no-op.
      if (isNoEntryError(err)) return;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    // `findCredentials` returns all accounts stored under KEYRING_SERVICE.
    // We then filter by prefix — the account field holds the full namespaced key.
    const credentials = await findCredentialsAsync(KEYRING_SERVICE);
    return credentials.map((c) => c.account).filter((account) => account.startsWith(prefix));
  }
}

/**
 * Heuristic to detect whether a caught error means "no such credential."
 * `keyring-rs` uses the message "No such credential" on most platforms.
 */
function isNoEntryError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("no entry") ||
    msg.includes("no such credential") ||
    msg.includes("not found") ||
    // macOS SecItemCopyMatching returns errSecItemNotFound
    msg.includes("errsecitemnotfound") ||
    // Windows CREDENTIAL_NOT_FOUND
    msg.includes("element not found")
  );
}

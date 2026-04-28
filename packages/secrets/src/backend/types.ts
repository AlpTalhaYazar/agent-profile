/**
 * Backend interface and keychain backend type definitions.
 *
 * The `Backend` interface is intentionally narrow so that Phase 2's
 * Electron `safeStorage` adapter can implement it without changes to
 * the consumer side.
 */

/**
 * The underlying keychain implementation in use.
 *
 * - `keychain-macos` — macOS Keychain Services (via Security.framework)
 * - `credential-manager` — Windows Credential Manager
 * - `libsecret` — Linux GNOME Secret Service (libsecret / gnome-keyring)
 * - `kwallet` — Linux KDE Wallet
 * - `basic-text` — Linux plaintext fallback (unsafe; fail-closed by default)
 * - `unavailable` — No keychain access (sandboxed, restricted environment)
 */
export type KeychainBackend =
  | "keychain-macos"
  | "credential-manager"
  | "libsecret"
  | "kwallet"
  | "safe-storage"
  | "basic-text"
  | "unavailable";

/**
 * Pluggable backend interface for keychain operations.
 *
 * All CRUD operations work on raw string keys (already namespaced by the
 * caller). The backend does not perform namespacing itself.
 *
 * Phase 2 will add an `ElectronSafeStorageBackend` that implements this
 * interface using `safeStorage.encryptString` / `decryptString`.
 */
export interface Backend {
  /** Which underlying keychain implementation backs this instance. */
  readonly kind: KeychainBackend;

  /**
   * Returns `true` if secrets stored by this backend are encrypted at rest
   * and protected from other users.
   *
   * `basic-text` and `unavailable` return `false`.
   */
  isSecure(): boolean;

  /**
   * Retrieves the secret value for the given key.
   *
   * @param key - The namespaced key (e.g. `"agent-profile.anthropic.work"`).
   * @returns The stored secret value, or `null` if not found.
   */
  get(key: string): Promise<string | null>;

  /**
   * Stores or updates a secret value.
   *
   * @param key - The namespaced key.
   * @param value - The secret value to store.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Removes a secret from the keychain.
   *
   * @param key - The namespaced key to remove.
   */
  remove(key: string): Promise<void>;

  /**
   * Lists all keys that start with the given prefix.
   *
   * Returns key names only — no values. Implementations must never include
   * the secret value in any returned data.
   *
   * @param prefix - The key prefix to filter by (e.g. `"agent-profile."`).
   * @returns An array of matching key names.
   */
  list(prefix: string): Promise<string[]>;

  /**
   * Optional fast-path existence check.
   *
   * Backends MAY implement this to avoid round-tripping a value through
   * decryption purely to test whether a key is set. Callers that need
   * portability across backends should fall back to `(await get(k)) !== null`
   * when `has` is missing.
   *
   * @param key - The namespaced key to test.
   */
  has?(key: string): Promise<boolean>;
}

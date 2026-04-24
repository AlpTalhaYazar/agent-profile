/**
 * Error classes for `@agent-profile/secrets`.
 *
 * All error messages include the key/service/ref **identifier**, never the value.
 */

/**
 * Thrown when a secret key is not found in the keychain.
 */
export class SecretNotFoundError extends Error {
  /** The namespaced key that was not found. */
  readonly key: string;

  constructor(key: string) {
    super(`Secret not found: ${key}`);
    this.name = "SecretNotFoundError";
    this.key = key;
  }
}

/**
 * Thrown when the keychain backend is entirely unavailable
 * (e.g., sandboxed environment with no keychain access).
 */
export class KeychainUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ? `Keychain unavailable: ${detail}` : "Keychain unavailable");
    this.name = "KeychainUnavailableError";
  }
}

/**
 * Thrown when a write/read/remove is attempted against the `basic-text` backend
 * without `MYCLAUDE_ALLOW_PLAINTEXT=1`.
 *
 * The `basic-text` backend stores secrets as plaintext on disk, which is
 * considered unsafe. Users must opt in explicitly via the environment variable.
 *
 * Install hint:
 * ```
 *   Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring
 *   Fedora:         sudo dnf install libsecret
 *   Arch:           sudo pacman -S libsecret
 * ```
 */
export class BackendUnsafeError extends Error {
  /** The key identifier that was attempted (not the value). */
  readonly key: string;

  constructor(key: string) {
    super(
      `Linux secret service unavailable (basic_text backend detected).\nRefusing to access secret "${key}" unencrypted.\nFix:\n  Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring\n  Fedora:         sudo dnf install libsecret\n  Arch:           sudo pacman -S libsecret\n\nAlternatively, set MYCLAUDE_ALLOW_PLAINTEXT=1 if you understand the risk\n(e.g., CI containers with ephemeral filesystem and no network-accessible\nsecrets).`
    );
    this.name = "BackendUnsafeError";
    this.key = key;
  }
}

/**
 * Thrown when a keyring URI or secret ref string is malformed.
 */
export class InvalidSecretRefError extends Error {
  /** The invalid ref string that was provided. */
  readonly ref: string;

  constructor(ref: string, detail?: string) {
    super(detail ? `Invalid secret ref "${ref}": ${detail}` : `Invalid secret ref: "${ref}"`);
    this.name = "InvalidSecretRefError";
    this.ref = ref;
  }
}

/**
 * @module auth/get-secret-ref
 *
 * Pure data service that returns the keyring URI for a single named secret on
 * an auth profile, or `null` if the auth profile / secret name does not exist.
 *
 * NEVER reads the keychain — only metadata from `authProfiles.yml`. Designed
 * for the daemon: the desktop app needs the URI to call `keytar` itself.
 */
import { loadAuthProfiles } from "./profiles-file.js";

/**
 * Input options for `authGetSecretRefService`.
 */
export interface AuthGetSecretRefInput {
  /**
   * Absolute path to the myclaude home. Optional only for legacy parity; the
   * daemon should always pass it explicitly.
   */
  home?: string;
  /**
   * The auth profile id (the YAML key under `authProfiles`).
   */
  authId: string;
  /**
   * The secret name. Use the literal `"anthropic"` to look up the Anthropic
   * API key URI; any other value is treated as an MCP secret name (the key
   * under `mcpSecretRefs`).
   */
  name: string;
}

/**
 * Result returned by `authGetSecretRefService`. The keyring URI, or `null` if
 * the requested combination does not resolve to a configured secret.
 */
export interface AuthGetSecretRefResult {
  /** The `keyring://service/account` URI, or `null` when unknown. */
  ref: string | null;
}

/**
 * Look up a secret reference (keyring URI) on a single auth profile.
 *
 * Returns `{ ref: null }` for any of:
 *   - The auth profile id is unknown.
 *   - The secret name is unknown on that profile.
 *   - `authProfiles.yml` is missing.
 *
 * @throws {ServiceError} Only when `authProfiles.yml` is present but invalid.
 */
export function authGetSecretRefService(input: AuthGetSecretRefInput): AuthGetSecretRefResult {
  const { home, authId, name } = input;
  const doc = loadAuthProfiles(home);
  const profile = doc.authProfiles[authId];
  if (!profile) return { ref: null };

  if (name === "anthropic") {
    return { ref: profile.anthropic.secretRef };
  }

  const ref = profile.mcpSecretRefs[name];
  return { ref: ref ?? null };
}

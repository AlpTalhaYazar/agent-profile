/**
 * CRUD wrappers for keychain operations.
 *
 * These functions:
 * 1. Apply the `agent-profile.` namespace prefix via `toKeyringKey`.
 * 2. Enforce the `basic-text` fail-closed policy.
 * 3. Accept an optional injected `Backend` for dependency injection in tests.
 *
 * Never call these functions with real secret values in tests. Always inject
 * a `MockBackend`.
 */

import { getBackend } from "./backend/detect.js";
import type { Backend } from "./backend/types.js";
import { BackendUnsafeError, SecretNotFoundError } from "./errors.js";
import { KEY_PREFIX, toKeyringKey } from "./namespace.js";

/**
 * Asserts that the backend is safe to use for write/read/remove operations.
 *
 * Throws `BackendUnsafeError` if the backend is `basic-text` and
 * `MYCLAUDE_ALLOW_PLAINTEXT=1` is not set.
 *
 * When `MYCLAUDE_ALLOW_PLAINTEXT=1` is set, a deprecation warning is written
 * to stderr to remind the user they are using an unsafe backend.
 */
function assertSafe(backend: Backend, key: string): void {
  if (backend.kind === "basic-text") {
    if (process.env.MYCLAUDE_ALLOW_PLAINTEXT !== "1") {
      throw new BackendUnsafeError(key);
    }
    // Warn when the escape hatch is in use.
    process.stderr.write(
      `[agent-profile/secrets] WARNING: MYCLAUDE_ALLOW_PLAINTEXT=1 is set. Secret "${key}" will be stored as plaintext. This is unsafe outside of CI/testing environments.\n`
    );
  }
}

/**
 * Retrieves a secret from the keychain.
 *
 * @param service - The service name (e.g. `"anthropic"`).
 * @param account - The account name (e.g. `"work"`).
 * @param backend - Optional injected backend. Defaults to `getBackend()`.
 * @returns The secret value.
 * @throws {SecretNotFoundError} If the secret does not exist.
 * @throws {BackendUnsafeError} If the backend is `basic-text` without opt-in.
 */
export async function getSecret(
  service: string,
  account: string,
  backend?: Backend
): Promise<string> {
  const b = backend ?? (await getBackend());
  const key = toKeyringKey(service, account);
  assertSafe(b, key);
  const value = await b.get(key);
  if (value === null) {
    throw new SecretNotFoundError(key);
  }
  return value;
}

/**
 * Stores a secret in the keychain.
 *
 * @param service - The service name.
 * @param account - The account name.
 * @param value - The secret value to store.
 * @param backend - Optional injected backend.
 * @throws {BackendUnsafeError} If the backend is `basic-text` without opt-in.
 */
export async function setSecret(
  service: string,
  account: string,
  value: string,
  backend?: Backend
): Promise<void> {
  const b = backend ?? (await getBackend());
  const key = toKeyringKey(service, account);
  assertSafe(b, key);
  await b.set(key, value);
}

/**
 * Removes a secret from the keychain.
 *
 * @param service - The service name.
 * @param account - The account name.
 * @param backend - Optional injected backend.
 * @throws {BackendUnsafeError} If the backend is `basic-text` without opt-in.
 */
export async function removeSecret(
  service: string,
  account: string,
  backend?: Backend
): Promise<void> {
  const b = backend ?? (await getBackend());
  const key = toKeyringKey(service, account);
  assertSafe(b, key);
  await b.remove(key);
}

/**
 * Lists all secret keys stored under the `agent-profile.` prefix.
 *
 * Returns key names only — no values. This operation is allowed even when
 * the backend is `basic-text` because no secret material is returned.
 *
 * @param backend - Optional injected backend.
 * @returns Array of namespaced key strings (e.g. `["agent-profile.anthropic.work"]`).
 */
export async function listSecretKeys(backend?: Backend): Promise<string[]> {
  const b = backend ?? (await getBackend());
  // list() is always allowed, even on basic-text — no secret values returned.
  return b.list(`${KEY_PREFIX}.`);
}

/**
 * Checks whether a secret exists in the keychain without returning the value.
 *
 * @param service - The service name.
 * @param account - The account name.
 * @param backend - Optional injected backend.
 * @returns `true` if the secret exists, `false` otherwise.
 * @throws {BackendUnsafeError} If the backend is `basic-text` without opt-in.
 */
export async function hasSecret(
  service: string,
  account: string,
  backend?: Backend
): Promise<boolean> {
  const b = backend ?? (await getBackend());
  const key = toKeyringKey(service, account);
  assertSafe(b, key);
  const value = await b.get(key);
  return value !== null;
}

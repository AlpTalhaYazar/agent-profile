/**
 * @module @agent-profile/secrets
 *
 * OS-keychain-backed secret store and resolver for `@agent-profile/core`
 * effective configs. Provides CRUD operations against the system keychain
 * and a `resolveSecrets` function that materializes all secret references
 * (`keyring://`, `${secret:name}`, `${env:VAR}`) in a cascaded config.
 *
 * ## Security notes
 *
 * - Secrets never appear in logs, error messages, or the resolution log.
 * - `ANTHROPIC_API_KEY` is NOT set by `resolveSecrets`. It is delivered via
 *   `apiKeyHelper.sh` in Sprint 5. See `resolve-secrets.ts` for the TODO.
 * - On Linux with the `basic-text` backend, write/read/remove operations are
 *   refused unless `MYCLAUDE_ALLOW_PLAINTEXT=1` is set.
 *
 * ## Dependency injection
 *
 * All CRUD functions and `resolveSecrets` accept an optional `backend` parameter.
 * In tests, always pass a `MockBackend` to avoid touching the real OS keychain.
 */

// ─── Backend detection + store ops ───────────────────────────────────────────

export { getBackend, isBackendSecure } from "./backend/detect.js";
export type { Backend, KeychainBackend } from "./backend/types.js";

// ─── safeStorage backend + migrator (Phase 2 milestone 3) ─────────────────────

export {
  SafeStorageStore,
  createSafeStorageStore,
  type SafeStorageStoreOptions,
} from "./backend/safe-storage.js";
export {
  migrateKeyringToSafeStorage,
  type MigrationReport,
  type MigrationOptions,
} from "./migration/keyring-to-safe.js";

// ─── CRUD against the keychain ────────────────────────────────────────────────

export { getSecret, setSecret, removeSecret, listSecretKeys, hasSecret } from "./store.js";

// ─── Namespacing ──────────────────────────────────────────────────────────────

export { toKeyringKey, parseKeyringUri } from "./namespace.js";

// ─── Resolver ─────────────────────────────────────────────────────────────────

export {
  resolveSecrets,
  type ResolveSecretsInput,
  type ResolveSecretsResult,
  type MissingRef,
} from "./resolver/resolve-secrets.js";

export type { ResolutionLogEntry, ResolutionSource } from "./resolver/resolution-log.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export {
  SecretNotFoundError,
  KeychainUnavailableError,
  BackendUnsafeError,
  InvalidSecretRefError,
} from "./errors.js";

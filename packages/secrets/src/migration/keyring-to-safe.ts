/**
 * @module @agent-profile/secrets/migration/keyring-to-safe
 *
 * One-way, idempotent migration from `@napi-rs/keyring` entries (the Phase 1
 * standalone backend) to the `safeStorage`-encrypted file store (Phase 2
 * daemon backend).
 *
 * Direction is intentional and recorded in ADR 002: keyring → safeStorage
 * only. Reverse export would defeat the macOS Keychain ACL binding that
 * makes `safeStorage` strictly stronger.
 *
 * Idempotency: a second run finds every key already in the destination and
 * counts them as `skipped`.
 */

import type { SafeStorageStore } from "../backend/safe-storage.js";
import type { Backend } from "../backend/types.js";
import { KEY_PREFIX } from "../namespace.js";

/** Outcome of one {@link migrateKeyringToSafeStorage} invocation. */
export interface MigrationReport {
  /** Total number of keys read from the keyring backend. */
  scanned: number;
  /** Keys whose value was successfully copied to the destination. */
  migrated: number;
  /** Keys already present in the destination (no-op). */
  skipped: number;
  /** Per-key failures. Reasons never include secret material — only the namespaced key and the error message. */
  errors: { key: string; reason: string }[];
  /** Whether the call was a planning run (no writes). */
  dryRun: boolean;
}

/** Options for {@link migrateKeyringToSafeStorage}. */
export interface MigrationOptions {
  /** Source backend — typically a `KeyringBackend`. */
  keyring: Backend;
  /** Destination store. */
  safeStore: SafeStorageStore;
  /** When `true`, plan only — no writes. Defaults to `false`. */
  dryRun?: boolean;
  /**
   * When `true` (default), keyring entries are left in place after a
   * successful copy so standalone CLI invocations retain read access. When
   * `false`, they are deleted as soon as the destination has the value.
   */
  keepKeyring?: boolean;
}

/**
 * Migrate every `agent-profile.*` keyring entry to the `safeStorage` store.
 *
 * Per-key failures are isolated: one bad entry never aborts the run. The
 * report's counters always satisfy
 * `migrated + skipped + errors.length === scanned`.
 */
export async function migrateKeyringToSafeStorage(
  opts: MigrationOptions
): Promise<MigrationReport> {
  const { keyring, safeStore } = opts;
  const dryRun = opts.dryRun ?? false;
  const keepKeyring = opts.keepKeyring ?? true;

  const keys = await keyring.list(`${KEY_PREFIX}.`);
  const errors: { key: string; reason: string }[] = [];
  let migrated = 0;
  let skipped = 0;

  for (const key of keys) {
    try {
      if (await safeStore.has(key)) {
        skipped += 1;
        continue;
      }
      if (dryRun) {
        migrated += 1;
        continue;
      }
      const value = await keyring.get(key);
      if (value === null) {
        errors.push({ key, reason: "keyring entry vanished mid-migration" });
        continue;
      }
      await safeStore.set(key, value);
      if (!keepKeyring) {
        try {
          await keyring.remove(key);
        } catch (err) {
          // The destination already has the value — log a soft error but
          // count as migrated so a follow-up run can finish the cleanup.
          errors.push({
            key,
            reason: `copied but keyring.remove failed: ${describeError(err)}`,
          });
        }
      }
      migrated += 1;
    } catch (err) {
      errors.push({ key, reason: describeError(err) });
    }
  }

  return {
    scanned: keys.length,
    migrated,
    skipped,
    errors,
    dryRun,
  };
}

/** Stringify an unknown thrown value without leaking secret material. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

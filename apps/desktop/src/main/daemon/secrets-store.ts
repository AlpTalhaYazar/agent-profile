/**
 * @module daemon/secrets-store
 *
 * Daemon-side `SafeStorageStore` factory.
 *
 * The actual encryption primitives live in Electron's `safeStorage`; we bind
 * its API surface to the injected callbacks the secrets package expects.
 * `safeStorage` may not be ready until `app.whenReady()` resolves — callers
 * MUST construct this only after that point.
 *
 * Linux `basic_text` policy: when `safeStorage.getSelectedStorageBackend()`
 * returns `basic_text` we surface a `kind: "basic-text"` store. The daemon
 * write-side handlers refuse to persist into a non-secure store unless
 * `MYCLAUDE_ALLOW_PLAINTEXT=1` is set, matching the existing CLI policy.
 */

import { join } from "node:path";
import {
  type SafeStorageStore,
  type SafeStorageStoreOptions,
  createSafeStorageStore,
} from "@agent-profile/secrets";

/** Subset of Electron's `safeStorage` surface this module needs. */
export interface SafeStorageLike {
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
  getSelectedStorageBackend?: () =>
    | "basic_text"
    | "gnome_libsecret"
    | "kwallet"
    | "kwallet5"
    | "kwallet6"
    | "keychain"
    | "kwallet7"
    | "unknown";
  isEncryptionAvailable?: () => boolean;
}

/** Options for {@link buildSecretsStore}. */
export interface BuildSecretsStoreOptions {
  /** Absolute path to `<myClaudeHome>` (e.g. `~/.myclaude`). */
  myClaudeHome: string;
  /** Electron `safeStorage` (or a stand-in for tests). */
  safeStorage: SafeStorageLike;
  /** Override the standard filename for tests. */
  fileName?: string;
  /** Environment override for tests. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Construct the daemon's `SafeStorageStore` instance, binding it to the
 * provided `safeStorage` API and the canonical `<home>/secrets.enc.json` path.
 *
 * The returned store is fully loaded (initial disk read complete).
 */
export async function buildSecretsStore(opts: BuildSecretsStoreOptions): Promise<SafeStorageStore> {
  const filePath = join(opts.myClaudeHome, opts.fileName ?? "secrets.enc.json");
  const env = opts.env ?? process.env;
  if (shouldUsePlaintextStore(opts.safeStorage, env)) {
    return createSafeStorageStore({
      encrypt: (plain: string): Buffer => Buffer.from(plain, "utf8"),
      decrypt: (cipher: Buffer): string => cipher.toString("utf8"),
      filePath,
      kind: "basic-text",
    });
  }
  const kind = detectStoreKind(opts.safeStorage);
  const storeOpts: SafeStorageStoreOptions = {
    encrypt: (plain: string): Buffer => opts.safeStorage.encryptString(plain),
    decrypt: (cipher: Buffer): string => opts.safeStorage.decryptString(cipher),
    filePath,
    kind,
  };
  return createSafeStorageStore(storeOpts);
}

function shouldUsePlaintextStore(safeStorage: SafeStorageLike, env: NodeJS.ProcessEnv): boolean {
  if (env.MYCLAUDE_ALLOW_PLAINTEXT !== "1") return false;
  if (env.MYCLAUDE_E2E_PLAINTEXT_SECRETS === "1") return true;
  return safeStorage.isEncryptionAvailable?.() === false;
}

/**
 * Map Electron's reported backend to the secrets package's `KeychainBackend`.
 *
 * `basic_text` (Linux without libsecret/kwallet) maps to `"basic-text"` so
 * downstream gates engage. Anything else is the strong path —
 * `"safe-storage"`.
 */
function detectStoreKind(safeStorage: SafeStorageLike): "safe-storage" | "basic-text" {
  const reported = safeStorage.getSelectedStorageBackend?.();
  if (reported === "basic_text") return "basic-text";
  return "safe-storage";
}

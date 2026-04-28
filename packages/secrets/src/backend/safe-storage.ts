/**
 * @module @agent-profile/secrets/backend/safe-storage
 *
 * `SafeStorageStore` is the daemon-side `Backend` implementation. It stores
 * encrypted secrets in a single user-scoped file (`secrets.enc.json`) and
 * delegates the actual encryption to caller-injected `encrypt` / `decrypt`
 * callbacks. The daemon binds those callbacks to Electron's `safeStorage`;
 * tests inject deterministic stand-ins.
 *
 * This package therefore takes **no Electron dependency**. It only owns the
 * file format, the in-memory map, and the on-disk atomic-write protocol.
 *
 * Security:
 *  - Plaintext exists only on the call stack between `set` ↔ `encrypt` and
 *    between `decrypt` ↔ caller. We never log it, never include it in errors,
 *    never store it.
 *  - Disk file is mode `0600` after every write (POSIX). Win32 relies on
 *    DPAPI / per-user file ACLs.
 *  - Atomic write uses `<filePath>.tmp-<random>` + `rename`; the parent
 *    directory is the `~/.myclaude` user dir, so EXDEV is not a concern.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Backend, KeychainBackend } from "./types.js";

/** Disk format version for {@link SafeStorageStore}. Bump on any breaking schema change. */
const STORE_VERSION = 1;

/** Single entry in the on-disk file. `ciphertextB64` is opaque to this layer. */
interface StoreEntry {
  ciphertextB64: string;
  createdAt: number;
}

/** On-disk JSON shape. */
interface StoreFile {
  version: typeof STORE_VERSION;
  entries: Record<string, StoreEntry>;
}

/**
 * Constructor options for {@link SafeStorageStore}.
 *
 * `encrypt` and `decrypt` are intentionally synchronous to match Electron's
 * `safeStorage` API. They MUST throw rather than return a partial result on
 * failure — `SafeStorageStore` translates throws into rejected promises.
 */
export interface SafeStorageStoreOptions {
  /** Plaintext → ciphertext. Daemon binds to `safeStorage.encryptString`. */
  encrypt: (plaintext: string) => Buffer;
  /** Ciphertext → plaintext. Daemon binds to `safeStorage.decryptString`. */
  decrypt: (ciphertext: Buffer) => string;
  /** Absolute path to the secrets file (e.g. `<myClaudeHome>/secrets.enc.json`). */
  filePath: string;
  /**
   * Backend kind to advertise. Defaults to `"safe-storage"`. Tests may pass
   * `"basic-text"` when emulating the Linux fallback to assert downstream
   * gates engage correctly.
   */
  kind?: KeychainBackend;
  /** Clock source for `createdAt` timestamps; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * File-backed encrypted secret store.
 *
 * Construct via {@link createSafeStorageStore} (which performs the initial
 * disk read) rather than `new SafeStorageStore(...)` to avoid a half-loaded
 * state.
 */
export class SafeStorageStore implements Backend {
  readonly kind: KeychainBackend;
  private readonly encrypt: (plaintext: string) => Buffer;
  private readonly decrypt: (ciphertext: Buffer) => string;
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly entries: Map<string, StoreEntry> = new Map();
  private loaded = false;

  constructor(opts: SafeStorageStoreOptions) {
    this.encrypt = opts.encrypt;
    this.decrypt = opts.decrypt;
    this.filePath = opts.filePath;
    this.kind = opts.kind ?? "safe-storage";
    this.now = opts.now ?? (() => Date.now());
  }

  isSecure(): boolean {
    return this.kind !== "basic-text" && this.kind !== "unavailable";
  }

  /**
   * Eagerly load the on-disk file into memory. Idempotent. Missing file is
   * treated as an empty store.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.loaded = true;
        return;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SafeStorageStore: malformed JSON in ${this.filePath}: ${message}`);
    }
    if (!isStoreFile(parsed)) {
      throw new Error(`SafeStorageStore: invalid file shape at ${this.filePath}`);
    }
    if (parsed.version !== STORE_VERSION) {
      throw new Error(
        `SafeStorageStore: unsupported file version ${parsed.version} (expected ${STORE_VERSION})`
      );
    }
    for (const [key, entry] of Object.entries(parsed.entries)) {
      this.entries.set(key, entry);
    }
    this.loaded = true;
  }

  async get(key: string): Promise<string | null> {
    await this.load();
    const entry = this.entries.get(key);
    if (!entry) return null;
    const cipherBuf = Buffer.from(entry.ciphertextB64, "base64");
    return this.decrypt(cipherBuf);
  }

  async set(key: string, value: string): Promise<void> {
    await this.load();
    const cipher = this.encrypt(value);
    this.entries.set(key, {
      ciphertextB64: cipher.toString("base64"),
      createdAt: this.now(),
    });
    await this.flush();
  }

  async remove(key: string): Promise<void> {
    await this.load();
    if (!this.entries.delete(key)) return;
    await this.flush();
  }

  async list(prefix: string): Promise<string[]> {
    await this.load();
    return Array.from(this.entries.keys()).filter((k) => k.startsWith(prefix));
  }

  async has(key: string): Promise<boolean> {
    await this.load();
    return this.entries.has(key);
  }

  /**
   * Atomically replace the on-disk file with the current in-memory state.
   *
   * Writes to `<filePath>.tmp-<rand>` first, chmods 0600, then renames over
   * the destination. The temp file lives in the same directory as the target
   * so `rename` cannot cross filesystem boundaries.
   */
  private async flush(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmpPath = `${this.filePath}.tmp-${randomBytes(6).toString("hex")}`;
    const payload: StoreFile = {
      version: STORE_VERSION,
      entries: Object.fromEntries(this.entries),
    };
    try {
      await writeFile(tmpPath, JSON.stringify(payload), { encoding: "utf8" });
      if (process.platform !== "win32") {
        try {
          await chmod(tmpPath, 0o600);
        } catch {
          // chmod failure is best-effort; the parent dir is already 0700.
        }
      }
      await rename(tmpPath, this.filePath);
    } catch (err) {
      try {
        await rm(tmpPath, { force: true });
      } catch {
        // best-effort cleanup
      }
      throw err;
    }
  }
}

/** Type guard for the on-disk shape. */
function isStoreFile(value: unknown): value is StoreFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "number") return false;
  if (typeof v.entries !== "object" || v.entries === null) return false;
  for (const entry of Object.values(v.entries as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.ciphertextB64 !== "string") return false;
    if (typeof e.createdAt !== "number") return false;
  }
  return true;
}

/**
 * Async factory for {@link SafeStorageStore}. Calls `load()` eagerly so the
 * caller never observes a half-initialized state.
 */
export async function createSafeStorageStore(
  opts: SafeStorageStoreOptions
): Promise<SafeStorageStore> {
  const store = new SafeStorageStore(opts);
  await store.load();
  return store;
}

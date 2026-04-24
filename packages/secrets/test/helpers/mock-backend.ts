/**
 * In-memory mock backend for tests.
 *
 * NEVER uses the real OS keychain. Every test that needs keychain access
 * must pass this backend directly to avoid side effects on the developer's
 * system.
 */

import type { Backend, KeychainBackend } from "../../src/backend/types.js";

/**
 * An in-memory `Backend` implementation suitable for unit tests.
 *
 * Stores secrets in a plain `Map<string, string>`. Supports all operations
 * including list() with prefix filtering.
 */
export class MockBackend implements Backend {
  readonly kind: KeychainBackend;
  private readonly store = new Map<string, string>();

  constructor(kind: KeychainBackend = "keychain-macos") {
    this.kind = kind;
  }

  isSecure(): boolean {
    return this.kind !== "basic-text" && this.kind !== "unavailable";
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
  }

  /** Test helper: seed the store without going through CRUD guards. */
  seed(key: string, value: string): this {
    this.store.set(key, value);
    return this;
  }

  /** Test helper: expose current store size. */
  get size(): number {
    return this.store.size;
  }
}

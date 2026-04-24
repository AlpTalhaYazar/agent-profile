/**
 * In-memory mock backend for helper tests.
 *
 * Mirrors `packages/secrets/test/helpers/mock-backend.ts`. Duplicated here
 * because `MockBackend` is not exported from `@agent-profile/secrets` (it
 * lives under the package's `test/` directory, which is excluded from the
 * published surface).
 */

import type { Backend, KeychainBackend } from "@agent-profile/secrets";

/** In-memory `Backend` implementation suitable for unit tests. */
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
    this.getCalls.push(key);
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

  /** Test helper: record of every key `.get()` has been called with. */
  readonly getCalls: string[] = [];
}

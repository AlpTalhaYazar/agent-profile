/**
 * Tests for {@link migrateKeyringToSafeStorage}.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSafeStorageStore } from "../src/backend/safe-storage.js";
import { migrateKeyringToSafeStorage } from "../src/migration/keyring-to-safe.js";
import { MockBackend } from "./helpers/mock-backend.js";

const encrypt = (s: string): Buffer => Buffer.from(`ENC:${s}`, "utf8");
const decrypt = (b: Buffer): string => b.toString("utf8").slice(4);

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "secret-migrate-"));
  const filePath = join(dir, "secrets.enc.json");
  const safeStore = await createSafeStorageStore({ encrypt, decrypt, filePath });
  const keyring = new MockBackend("keychain-macos");
  return { dir, safeStore, keyring };
}

describe("migrateKeyringToSafeStorage", () => {
  let dir: string;

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("migrates every agent-profile.* entry to the safe store", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.anthropic.work", "A");
    ctx.keyring.seed("agent-profile.anthropic.personal", "P");
    ctx.keyring.seed("agent-profile.github.work", "G");

    const report = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });

    expect(report).toMatchObject({
      scanned: 3,
      migrated: 3,
      skipped: 0,
      errors: [],
      dryRun: false,
    });
    expect(await ctx.safeStore.get("agent-profile.anthropic.work")).toBe("A");
    expect(await ctx.safeStore.get("agent-profile.anthropic.personal")).toBe("P");
    expect(await ctx.safeStore.get("agent-profile.github.work")).toBe("G");
  });

  it("is idempotent — second run skips everything", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.anthropic.work", "A");
    ctx.keyring.seed("agent-profile.github.work", "G");

    const r1 = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });
    expect(r1.migrated).toBe(2);

    const r2 = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });
    expect(r2).toMatchObject({ scanned: 2, migrated: 0, skipped: 2, errors: [] });
  });

  it("dryRun reports a plan but does not write to the store", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.anthropic.work", "A");
    ctx.keyring.seed("agent-profile.github.work", "G");

    const r = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
      dryRun: true,
    });

    expect(r).toMatchObject({ scanned: 2, migrated: 2, skipped: 0, dryRun: true });
    expect(await ctx.safeStore.list("agent-profile.")).toEqual([]);
    // Source untouched.
    expect(await ctx.keyring.get("agent-profile.anthropic.work")).toBe("A");
  });

  it("keepKeyring: false removes source entries after a successful copy", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.anthropic.work", "A");
    ctx.keyring.seed("agent-profile.github.work", "G");

    await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
      keepKeyring: false,
    });

    expect(await ctx.keyring.get("agent-profile.anthropic.work")).toBeNull();
    expect(await ctx.keyring.get("agent-profile.github.work")).toBeNull();
    expect(await ctx.safeStore.get("agent-profile.anthropic.work")).toBe("A");
  });

  it("keepKeyring: true (default) leaves source entries in place", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.anthropic.work", "A");

    await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });

    expect(await ctx.keyring.get("agent-profile.anthropic.work")).toBe("A");
    expect(await ctx.safeStore.get("agent-profile.anthropic.work")).toBe("A");
  });

  it("isolates per-key failures and continues with the rest", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.anthropic.work", "A");
    ctx.keyring.seed("agent-profile.broken.entry", "B");
    ctx.keyring.seed("agent-profile.github.work", "G");

    // Sabotage the get() of one key so it throws.
    const originalGet = ctx.keyring.get.bind(ctx.keyring);
    ctx.keyring.get = async (key: string): Promise<string | null> => {
      if (key === "agent-profile.broken.entry") {
        throw new Error("simulated keyring failure");
      }
      return originalGet(key);
    };

    const r = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });

    expect(r.scanned).toBe(3);
    expect(r.migrated).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.key).toBe("agent-profile.broken.entry");
    expect(r.errors[0]?.reason).toContain("simulated keyring failure");
    // Counters always sum to scanned.
    expect(r.migrated + r.skipped + r.errors.length).toBe(r.scanned);
  });

  it("treats a missing source value as an error, not a silent drop", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.real.entry", "X");
    // Inject a key into list() that get() will return null for.
    const origList = ctx.keyring.list.bind(ctx.keyring);
    ctx.keyring.list = async (prefix: string): Promise<string[]> => {
      const real = await origList(prefix);
      return [...real, "agent-profile.ghost.entry"];
    };

    const r = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });

    expect(r.scanned).toBe(2);
    expect(r.migrated).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.key).toBe("agent-profile.ghost.entry");
  });

  it("does not leak plaintext values into error messages", async () => {
    const ctx = await setup();
    dir = ctx.dir;
    ctx.keyring.seed("agent-profile.x.y", "ULTRA-SECRET-VALUE");

    // Make set() throw to force an error path.
    const origSet = ctx.safeStore.set.bind(ctx.safeStore);
    ctx.safeStore.set = async (): Promise<void> => {
      throw new Error("disk full");
    };

    const r = await migrateKeyringToSafeStorage({
      keyring: ctx.keyring,
      safeStore: ctx.safeStore,
    });

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).not.toContain("ULTRA-SECRET-VALUE");

    // Restore for cleanup
    ctx.safeStore.set = origSet;
  });
});

/**
 * Tests for {@link SafeStorageStore}.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SafeStorageStore, createSafeStorageStore } from "../src/backend/safe-storage.js";

/**
 * Trivial reversible "encryption" used in tests: `ENC:<plaintext>`. Real
 * daemon code binds to Electron's `safeStorage`. Anything we test here is
 * about the file format and CRUD plumbing, not crypto.
 */
const encrypt = (plaintext: string): Buffer => Buffer.from(`ENC:${plaintext}`, "utf8");
const decrypt = (cipher: Buffer): string => {
  const s = cipher.toString("utf8");
  if (!s.startsWith("ENC:")) throw new Error("test decrypt: bad cipher");
  return s.slice(4);
};

describe("SafeStorageStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "safe-store-"));
    filePath = join(dir, "secrets.enc.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty when the file does not exist", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    expect(await store.list("agent-profile.")).toEqual([]);
    expect(await store.has("agent-profile.x.y")).toBe(false);
    expect(await store.get("agent-profile.x.y")).toBeNull();
  });

  it("set + get round-trips through encrypt/decrypt", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await store.set("agent-profile.anthropic.work", "SECRET-A");
    expect(await store.get("agent-profile.anthropic.work")).toBe("SECRET-A");
  });

  it("persists ciphertext on disk and reloads in a fresh instance", async () => {
    const a = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await a.set("agent-profile.anthropic.work", "SECRET-A");

    const b = await createSafeStorageStore({ encrypt, decrypt, filePath });
    expect(await b.get("agent-profile.anthropic.work")).toBe("SECRET-A");
    expect(await b.has("agent-profile.anthropic.work")).toBe(true);
  });

  it("never writes plaintext to disk", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await store.set("agent-profile.anthropic.work", "PLAINTEXT-XYZ");
    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).not.toContain("PLAINTEXT-XYZ");
    expect(onDisk).toContain(Buffer.from("ENC:PLAINTEXT-XYZ", "utf8").toString("base64"));
  });

  it("writes the file with mode 0600 on POSIX", async () => {
    if (process.platform === "win32") return;
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await store.set("agent-profile.x.y", "v");
    const s = await stat(filePath);
    // eslint-disable-next-line no-bitwise
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("remove deletes the entry and persists", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await store.set("agent-profile.x.y", "v");
    await store.remove("agent-profile.x.y");
    expect(await store.has("agent-profile.x.y")).toBe(false);
    const reload = await createSafeStorageStore({ encrypt, decrypt, filePath });
    expect(await reload.has("agent-profile.x.y")).toBe(false);
  });

  it("remove of a missing key is a no-op", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await expect(store.remove("agent-profile.never.was")).resolves.toBeUndefined();
  });

  it("list filters by prefix", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await store.set("agent-profile.anthropic.work", "a");
    await store.set("agent-profile.github.work", "b");
    await store.set("agent-profile.anthropic.personal", "c");
    const anth = await store.list("agent-profile.anthropic.");
    expect(anth.sort()).toEqual([
      "agent-profile.anthropic.personal",
      "agent-profile.anthropic.work",
    ]);
  });

  it("isSecure returns true for the default kind", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    expect(store.kind).toBe("safe-storage");
    expect(store.isSecure()).toBe(true);
  });

  it("isSecure returns false when the daemon configures basic-text", async () => {
    const store = await createSafeStorageStore({
      encrypt,
      decrypt,
      filePath,
      kind: "basic-text",
    });
    expect(store.isSecure()).toBe(false);
  });

  it("rejects a malformed JSON file at load time", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "{not json", "utf8");
    const store = new SafeStorageStore({ encrypt, decrypt, filePath });
    await expect(store.load()).rejects.toThrow(/malformed JSON/);
  });

  it("rejects an unsupported file version", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, JSON.stringify({ version: 99, entries: {} }), "utf8");
    const store = new SafeStorageStore({ encrypt, decrypt, filePath });
    await expect(store.load()).rejects.toThrow(/file version/);
  });

  it("uses the injected clock for createdAt", async () => {
    let t = 5_000;
    const store = await createSafeStorageStore({
      encrypt,
      decrypt,
      filePath,
      now: () => t,
    });
    await store.set("agent-profile.x.y", "v");
    const onDisk = JSON.parse(await readFile(filePath, "utf8")) as {
      entries: Record<string, { createdAt: number }>;
    };
    expect(onDisk.entries["agent-profile.x.y"]?.createdAt).toBe(5_000);
    t = 9_000;
    await store.set("agent-profile.x.z", "w");
    const onDisk2 = JSON.parse(await readFile(filePath, "utf8")) as {
      entries: Record<string, { createdAt: number }>;
    };
    expect(onDisk2.entries["agent-profile.x.z"]?.createdAt).toBe(9_000);
  });

  it("createSafeStorageStore is idempotent across calls (load runs once)", async () => {
    const store = await createSafeStorageStore({ encrypt, decrypt, filePath });
    await store.load();
    await store.load();
    expect(await store.list("agent-profile.")).toEqual([]);
  });
});

/**
 * Tests for keychain CRUD operations.
 *
 * All tests use a `MockBackend` — the real OS keychain is never touched.
 */

import { describe, expect, it } from "vitest";
import { SecretNotFoundError } from "../src/errors.js";
import { getSecret, hasSecret, listSecretKeys, removeSecret, setSecret } from "../src/store.js";
import { MockBackend } from "./helpers/mock-backend.js";

describe("setSecret / getSecret roundtrip", () => {
  it("stores and retrieves a secret value", async () => {
    const backend = new MockBackend();
    await setSecret("anthropic", "work", "sk-ant-test-value", backend);
    const value = await getSecret("anthropic", "work", backend);
    expect(value).toBe("sk-ant-test-value");
  });

  it("overwrites an existing secret on re-set", async () => {
    const backend = new MockBackend();
    await setSecret("github", "work", "ghp_first", backend);
    await setSecret("github", "work", "ghp_second", backend);
    const value = await getSecret("github", "work", backend);
    expect(value).toBe("ghp_second");
  });
});

describe("getSecret", () => {
  it("throws SecretNotFoundError when the key does not exist", async () => {
    const backend = new MockBackend();
    await expect(getSecret("missing", "service", backend)).rejects.toThrow(SecretNotFoundError);
  });

  it("error message includes the key identifier, not the value", async () => {
    const backend = new MockBackend();
    try {
      await getSecret("anthropic", "work", backend);
    } catch (err) {
      expect(err).toBeInstanceOf(SecretNotFoundError);
      expect((err as SecretNotFoundError).message).toContain("agent-profile.anthropic.work");
    }
  });
});

describe("removeSecret", () => {
  it("removes a stored secret", async () => {
    const backend = new MockBackend();
    await setSecret("github", "personal", "ghp_token", backend);
    await removeSecret("github", "personal", backend);
    await expect(getSecret("github", "personal", backend)).rejects.toThrow(SecretNotFoundError);
  });

  it("is a no-op when the key does not exist", async () => {
    const backend = new MockBackend();
    // Should not throw
    await expect(removeSecret("nonexistent", "key", backend)).resolves.toBeUndefined();
  });
});

describe("listSecretKeys", () => {
  it("returns only namespaced keys", async () => {
    const backend = new MockBackend();
    await setSecret("anthropic", "work", "key1", backend);
    await setSecret("github", "acme", "key2", backend);

    const keys = await listSecretKeys(backend);
    expect(keys).toContain("agent-profile.anthropic.work");
    expect(keys).toContain("agent-profile.github.acme");
    expect(keys.every((k) => k.startsWith("agent-profile."))).toBe(true);
  });

  it("returns empty array when no secrets are stored", async () => {
    const backend = new MockBackend();
    expect(await listSecretKeys(backend)).toEqual([]);
  });
});

describe("hasSecret", () => {
  it("returns true when the secret exists", async () => {
    const backend = new MockBackend();
    await setSecret("figma", "personal", "fig_tok", backend);
    expect(await hasSecret("figma", "personal", backend)).toBe(true);
  });

  it("returns false when the secret does not exist", async () => {
    const backend = new MockBackend();
    expect(await hasSecret("figma", "missing", backend)).toBe(false);
  });

  it("does not expose the secret value in its return type", async () => {
    const backend = new MockBackend();
    await setSecret("svc", "acct", "super-secret", backend);
    const result = await hasSecret("svc", "acct", backend);
    // The return type is boolean — no way to get the value from it.
    expect(typeof result).toBe("boolean");
  });
});

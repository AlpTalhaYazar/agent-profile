import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSecretsStore } from "../src/main/daemon/secrets-store.js";

describe("buildSecretsStore", () => {
  it("uses the explicit e2e plaintext store without touching safeStorage", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-safe-store-"));
    const encryptString = vi.fn(() => {
      throw new Error("safeStorage should not be called");
    });
    const decryptString = vi.fn(() => {
      throw new Error("safeStorage should not be called");
    });

    try {
      const store = await buildSecretsStore({
        myClaudeHome: root,
        safeStorage: {
          encryptString,
          decryptString,
          getSelectedStorageBackend: () => "keychain",
          isEncryptionAvailable: () => true,
        },
        env: {
          MYCLAUDE_ALLOW_PLAINTEXT: "1",
          MYCLAUDE_E2E_PLAINTEXT_SECRETS: "1",
        },
      });

      expect(store.kind).toBe("basic-text");
      await store.set("agent-profile.anthropic.work", "fake-secret");
      await expect(store.get("agent-profile.anthropic.work")).resolves.toBe("fake-secret");
      expect(encryptString).not.toHaveBeenCalled();
      expect(decryptString).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the explicit plaintext fallback when safeStorage encryption is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-safe-store-"));
    const encryptString = vi.fn(() => {
      throw new Error("safeStorage should not be called");
    });
    const decryptString = vi.fn(() => {
      throw new Error("safeStorage should not be called");
    });

    try {
      const store = await buildSecretsStore({
        myClaudeHome: root,
        safeStorage: {
          encryptString,
          decryptString,
          getSelectedStorageBackend: () => "keychain",
          isEncryptionAvailable: () => false,
        },
        env: { MYCLAUDE_ALLOW_PLAINTEXT: "1" },
      });

      expect(store.kind).toBe("basic-text");
      await store.set("agent-profile.anthropic.work", "fake-secret");
      await expect(store.get("agent-profile.anthropic.work")).resolves.toBe("fake-secret");
      expect(encryptString).not.toHaveBeenCalled();
      expect(decryptString).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

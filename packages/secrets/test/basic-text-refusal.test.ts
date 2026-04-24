/**
 * Tests for the `basic-text` fail-closed policy.
 *
 * When the backend is `basic-text`, write/read/remove ops must throw
 * `BackendUnsafeError` unless `MYCLAUDE_ALLOW_PLAINTEXT=1` is set.
 * `listSecretKeys` is always allowed because it returns no secret values.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendUnsafeError } from "../src/errors.js";
import { resolveSecrets } from "../src/resolver/resolve-secrets.js";
import { getSecret, hasSecret, listSecretKeys, removeSecret, setSecret } from "../src/store.js";
import { MockBackend } from "./helpers/mock-backend.js";

const basicTextBackend = () => new MockBackend("basic-text");

describe("basic-text backend — fail-closed", () => {
  beforeEach(() => {
    // Ensure MYCLAUDE_ALLOW_PLAINTEXT is not set
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;
  });

  afterEach(() => {
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;
    vi.restoreAllMocks();
  });

  it("getSecret throws BackendUnsafeError", async () => {
    const backend = basicTextBackend();
    await expect(getSecret("svc", "acct", backend)).rejects.toThrow(BackendUnsafeError);
  });

  it("setSecret throws BackendUnsafeError", async () => {
    const backend = basicTextBackend();
    await expect(setSecret("svc", "acct", "value", backend)).rejects.toThrow(BackendUnsafeError);
  });

  it("removeSecret throws BackendUnsafeError", async () => {
    const backend = basicTextBackend();
    await expect(removeSecret("svc", "acct", backend)).rejects.toThrow(BackendUnsafeError);
  });

  it("hasSecret throws BackendUnsafeError", async () => {
    const backend = basicTextBackend();
    await expect(hasSecret("svc", "acct", backend)).rejects.toThrow(BackendUnsafeError);
  });

  it("BackendUnsafeError message includes the install hint", async () => {
    const backend = basicTextBackend();
    try {
      await getSecret("svc", "acct", backend);
    } catch (err) {
      expect(err).toBeInstanceOf(BackendUnsafeError);
      const msg = (err as BackendUnsafeError).message;
      expect(msg).toContain("basic_text backend detected");
      expect(msg).toContain("MYCLAUDE_ALLOW_PLAINTEXT=1");
      expect(msg).toMatch(/apt install|dnf install|pacman/);
    }
  });

  it("BackendUnsafeError does NOT include the secret value", async () => {
    const backend = basicTextBackend();
    try {
      await getSecret("svc", "acct", backend);
    } catch (err) {
      expect(err).toBeInstanceOf(BackendUnsafeError);
      // The key identifier is present; the value is not (and couldn't be — get was blocked)
      expect((err as BackendUnsafeError).message).not.toContain("secret-value-xyz");
    }
  });

  it("listSecretKeys is allowed (no secret values returned)", async () => {
    const backend = basicTextBackend();
    // This should NOT throw even with basic-text backend
    await expect(listSecretKeys(backend)).resolves.toEqual([]);
  });

  it("resolveSecrets throws BackendUnsafeError early", async () => {
    const backend = basicTextBackend();
    await expect(
      resolveSecrets({
        config: {
          version: 1,
          mcpServers: {},
          env: { TOKEN: "${secret:test}" },
          settings: {},
          use: [],
          disabledServers: [],
        },
        backend,
        env: {},
      })
    ).rejects.toThrow(BackendUnsafeError);
  });
});

describe("basic-text backend — MYCLAUDE_ALLOW_PLAINTEXT=1 escape hatch", () => {
  beforeEach(() => {
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = "1";
  });

  afterEach(() => {
    process.env.MYCLAUDE_ALLOW_PLAINTEXT = undefined;
    vi.restoreAllMocks();
  });

  it("allows setSecret when opt-in flag is set", async () => {
    const backend = new MockBackend("basic-text");
    // Should not throw
    await expect(setSecret("svc", "acct", "dummy-test-value", backend)).resolves.toBeUndefined();
  });

  it("allows getSecret when opt-in flag is set", async () => {
    const backend = new MockBackend("basic-text");
    // Pre-seed directly to avoid testing set path
    backend.seed("agent-profile.svc.acct", "dummy-value");
    await expect(getSecret("svc", "acct", backend)).resolves.toBe("dummy-value");
  });

  it("writes a deprecation warning to stderr when opt-in is set", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const backend = new MockBackend("basic-text");
    await setSecret("svc", "acct", "dummy-value", backend);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("MYCLAUDE_ALLOW_PLAINTEXT=1"));
  });
});

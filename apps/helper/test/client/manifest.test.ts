/**
 * Tests for the session-manifest loader.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSessionManifest } from "../../src/client/manifest.js";
import { EXIT_SESSION_UNKNOWN, HelperError } from "../../src/errors.js";

let tmpRoot = "";

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = "";
});

function makeSessionDir(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), "helper-manifest-"));
  return tmpRoot;
}

function validManifest() {
  return {
    version: 1,
    sessionId: "11111111-2222-3333-4444-555555555555",
    capabilityToken: "cap-token-xyz",
    authProfileId: "work",
    anthropic: {
      mode: "apiKey",
      secretRef: "keyring://anthropic/work",
    },
    mcpHeaders: {
      github: { Authorization: "Bearer ${secret:gh.pat}" },
    },
    mcpSecretRefs: {
      "gh.pat": "keyring://github/pat",
    },
  };
}

describe("loadSessionManifest — happy path", () => {
  it("parses a valid manifest and returns typed fields", async () => {
    const dir = makeSessionDir();
    await writeFile(join(dir, "session.json"), JSON.stringify(validManifest()), "utf8");

    const manifest = await loadSessionManifest(dir);

    expect(manifest.version).toBe(1);
    expect(manifest.sessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(manifest.capabilityToken).toBe("cap-token-xyz");
    expect(manifest.anthropic.mode).toBe("apiKey");
    expect(manifest.anthropic.secretRef).toBe("keyring://anthropic/work");
    expect(manifest.mcpHeaders.github?.Authorization).toBe("Bearer ${secret:gh.pat}");
    expect(manifest.mcpSecretRefs["gh.pat"]).toBe("keyring://github/pat");
  });

  it("applies defaults for optional mcpHeaders / mcpSecretRefs", async () => {
    const dir = makeSessionDir();
    const { mcpHeaders: _mh, mcpSecretRefs: _ms, ...m } = validManifest();
    void _mh;
    void _ms;
    await writeFile(join(dir, "session.json"), JSON.stringify(m), "utf8");

    const manifest = await loadSessionManifest(dir);
    expect(manifest.mcpHeaders).toEqual({});
    expect(manifest.mcpSecretRefs).toEqual({});
  });
});

describe("loadSessionManifest — ENOENT", () => {
  it("throws EXIT_SESSION_UNKNOWN when the session directory does not exist", async () => {
    const missing = join(tmpdir(), "helper-manifest-does-not-exist-XYZ-0001");
    await expect(loadSessionManifest(missing)).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_SESSION_UNKNOWN,
    });
  });

  it("throws EXIT_SESSION_UNKNOWN when session.json is missing in an existing dir", async () => {
    const dir = makeSessionDir(); // dir exists but contains no session.json
    await expect(loadSessionManifest(dir)).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError && e.exitCode === EXIT_SESSION_UNKNOWN && e.message.includes(dir)
      );
    });
  });
});

describe("loadSessionManifest — malformed JSON", () => {
  it("throws EXIT_SESSION_UNKNOWN with an invalid-manifest message", async () => {
    const dir = makeSessionDir();
    await writeFile(join(dir, "session.json"), "{not-json", "utf8");

    await expect(loadSessionManifest(dir)).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError &&
        e.exitCode === EXIT_SESSION_UNKNOWN &&
        e.message.startsWith("invalid session manifest:")
      );
    });
  });
});

describe("loadSessionManifest — schema failures", () => {
  it("rejects a manifest with the wrong version", async () => {
    const dir = makeSessionDir();
    const m = { ...validManifest(), version: 2 };
    await writeFile(join(dir, "session.json"), JSON.stringify(m), "utf8");

    await expect(loadSessionManifest(dir)).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError &&
        e.exitCode === EXIT_SESSION_UNKNOWN &&
        e.message.includes("invalid session manifest at version")
      );
    });
  });

  it("rejects a manifest missing capabilityToken", async () => {
    const dir = makeSessionDir();
    const { capabilityToken: _ct, ...m } = validManifest();
    void _ct;
    await writeFile(join(dir, "session.json"), JSON.stringify(m), "utf8");

    await expect(loadSessionManifest(dir)).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError &&
        e.exitCode === EXIT_SESSION_UNKNOWN &&
        e.message.includes("invalid session manifest at capabilityToken")
      );
    });
  });

  it("rejects a non-keyring:// anthropic.secretRef", async () => {
    const dir = makeSessionDir();
    const m = validManifest();
    m.anthropic.secretRef = "vault://nope";
    await writeFile(join(dir, "session.json"), JSON.stringify(m), "utf8");

    await expect(loadSessionManifest(dir)).rejects.toSatisfy((e) => {
      return (
        e instanceof HelperError &&
        e.exitCode === EXIT_SESSION_UNKNOWN &&
        e.message.includes("anthropic.secretRef") &&
        e.message.includes("keyring://")
      );
    });
  });
});

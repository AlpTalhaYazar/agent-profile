/**
 * Tests for the pure MCP-header secret resolver.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT_AUTH, HelperError } from "../../src/errors.js";
import { resolveHeaders } from "../../src/resolve/headers.js";
import { MockBackend } from "../helpers/mock-backend.js";

function buildBackend(): MockBackend {
  const backend = new MockBackend("keychain-macos");
  backend.seed("agent-profile.github.pat", "ghp_xxx");
  backend.seed("agent-profile.figma.work", "figtok");
  return backend;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveHeaders — reference kinds", () => {
  it("resolves a bare keyring:// ref", async () => {
    const out = await resolveHeaders({
      headers: { Authorization: "keyring://github/pat" },
      mcpSecretRefs: {},
      backend: buildBackend(),
    });
    expect(out.Authorization).toBe("ghp_xxx");
  });

  it("resolves a ${secret:name} ref via mcpSecretRefs", async () => {
    const out = await resolveHeaders({
      headers: { Authorization: "${secret:github.pat}" },
      mcpSecretRefs: { "github.pat": "keyring://github/pat" },
      backend: buildBackend(),
    });
    expect(out.Authorization).toBe("ghp_xxx");
  });

  it("resolves a ${env:VAR} ref from the injected env map", async () => {
    const out = await resolveHeaders({
      headers: { "X-Host": "${env:POSTGRES_HOST}" },
      mcpSecretRefs: {},
      backend: buildBackend(),
      env: { POSTGRES_HOST: "localhost" },
    });
    expect(out["X-Host"]).toBe("localhost");
  });

  it("resolves a ref embedded in a larger string", async () => {
    const out = await resolveHeaders({
      headers: { Authorization: "Bearer ${secret:github.pat}" },
      mcpSecretRefs: { "github.pat": "keyring://github/pat" },
      backend: buildBackend(),
    });
    expect(out.Authorization).toBe("Bearer ghp_xxx");
  });

  it("resolves multiple refs in a single header value", async () => {
    const out = await resolveHeaders({
      headers: {
        "X-Mixed": "user=${env:USER_NAME}; token=${secret:github.pat}; fig=keyring://figma/work",
      },
      mcpSecretRefs: { "github.pat": "keyring://github/pat" },
      backend: buildBackend(),
      env: { USER_NAME: "alice" },
    });
    expect(out["X-Mixed"]).toBe("user=alice; token=ghp_xxx; fig=figtok");
  });

  it("passes a header through unchanged when it contains no refs", async () => {
    const out = await resolveHeaders({
      headers: { "Content-Type": "application/json" },
      mcpSecretRefs: {},
      backend: buildBackend(),
    });
    expect(out["Content-Type"]).toBe("application/json");
  });

  it("returns an empty object for empty input", async () => {
    const out = await resolveHeaders({
      headers: {},
      mcpSecretRefs: {},
      backend: buildBackend(),
    });
    expect(out).toEqual({});
  });
});

describe("resolveHeaders — failure modes", () => {
  it("throws EXIT_AUTH when a ${secret:name} is not in mcpSecretRefs", async () => {
    await expect(
      resolveHeaders({
        headers: { Authorization: "Bearer ${secret:missing.pat}" },
        mcpSecretRefs: {},
        backend: buildBackend(),
      })
    ).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_AUTH,
      message: "unresolved secret reference: ${secret:missing.pat}",
    });
  });

  it("throws EXIT_AUTH when an ${env:VAR} is not set", async () => {
    await expect(
      resolveHeaders({
        headers: { "X-Host": "${env:NOT_SET_VAR}" },
        mcpSecretRefs: {},
        backend: buildBackend(),
        env: {},
      })
    ).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_AUTH,
      message: "unresolved secret reference: ${env:NOT_SET_VAR}",
    });
  });

  it("throws EXIT_AUTH when a keyring:// key is missing from the backend", async () => {
    await expect(
      resolveHeaders({
        headers: { Authorization: "keyring://absent/key" },
        mcpSecretRefs: {},
        backend: buildBackend(),
      })
    ).rejects.toMatchObject({
      name: "HelperError",
      exitCode: EXIT_AUTH,
      message: "unresolved secret reference: keyring://absent/key",
    });
  });

  it("never echoes a resolved secret value in an error message", async () => {
    const backend = new MockBackend("keychain-macos");
    backend.seed("agent-profile.good/key".replace("/", "."), "SECRET-VALUE-SHOULD-NOT-LEAK");
    try {
      await resolveHeaders({
        headers: {
          Authorization: "Bearer ${secret:missing.pat}",
        },
        mcpSecretRefs: {},
        backend,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(HelperError);
      expect((err as HelperError).message).not.toContain("SECRET-VALUE-SHOULD-NOT-LEAK");
    }
  });
});

describe("resolveHeaders — batching", () => {
  it("issues exactly one backend.get per unique keychain key", async () => {
    const backend = buildBackend();

    const headers: Record<string, string> = {
      "A-Header": "Bearer ${secret:github.pat}",
      "B-Header": "Bearer keyring://github/pat",
      "C-Header": "dup keyring://github/pat and ${secret:github.pat}",
      "D-Header": "fig=keyring://figma/work",
    };
    const mcpSecretRefs = { "github.pat": "keyring://github/pat" };

    const out = await resolveHeaders({ headers, mcpSecretRefs, backend });

    expect(out["A-Header"]).toBe("Bearer ghp_xxx");
    expect(out["B-Header"]).toBe("Bearer ghp_xxx");
    expect(out["C-Header"]).toBe("dup ghp_xxx and ghp_xxx");
    expect(out["D-Header"]).toBe("fig=figtok");

    // github/pat is referenced 3 times, figma/work once → 2 unique .get() calls.
    expect(backend.getCalls).toHaveLength(2);
    const uniq = new Set(backend.getCalls);
    expect(uniq.size).toBe(2);
    expect(uniq.has("agent-profile.github.pat")).toBe(true);
    expect(uniq.has("agent-profile.figma.work")).toBe(true);
  });

  it("does not mutate the input headers map", async () => {
    const input = { Authorization: "Bearer ${secret:github.pat}" };
    await resolveHeaders({
      headers: input,
      mcpSecretRefs: { "github.pat": "keyring://github/pat" },
      backend: buildBackend(),
    });
    expect(input.Authorization).toBe("Bearer ${secret:github.pat}");
  });

  it("defaults env to process.env when omitted", async () => {
    vi.stubEnv("HELPER_TEST_FIXED_ENV", "env-value-1");
    const out = await resolveHeaders({
      headers: { "X-Env": "${env:HELPER_TEST_FIXED_ENV}" },
      mcpSecretRefs: {},
      backend: buildBackend(),
    });
    expect(out["X-Env"]).toBe("env-value-1");
  });
});

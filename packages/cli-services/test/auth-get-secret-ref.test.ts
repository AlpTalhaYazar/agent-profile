/**
 * Tests for `authGetSecretRefService`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authGetSecretRefService } from "../src/auth/get-secret-ref.js";

describe("authGetSecretRefService", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(
      tmpdir(),
      `cli-svc-auth-get-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(join(tmpHome, "config"), { recursive: true });
    const yaml = `
version: 1
authProfiles:
  work:
    displayName: "Work"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs:
      github.pat: keyring://github/work
`.trim();
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns the keyring URI for a known MCP secret name", () => {
    expect(authGetSecretRefService({ home: tmpHome, authId: "work", name: "github.pat" })).toEqual({
      ref: "keyring://github/work",
    });
  });

  it("returns the Anthropic keyring URI when name is 'anthropic'", () => {
    expect(authGetSecretRefService({ home: tmpHome, authId: "work", name: "anthropic" })).toEqual({
      ref: "keyring://anthropic/work",
    });
  });

  it("returns ref: null for an unknown secret name on a known profile", () => {
    expect(authGetSecretRefService({ home: tmpHome, authId: "work", name: "unknown" })).toEqual({
      ref: null,
    });
  });

  it("returns ref: null for an unknown auth profile id", () => {
    expect(
      authGetSecretRefService({ home: tmpHome, authId: "missing", name: "github.pat" })
    ).toEqual({ ref: null });
  });

  it("returns ref: null when authProfiles.yml is missing", () => {
    rmSync(join(tmpHome, "config", "authProfiles.yml"));
    expect(authGetSecretRefService({ home: tmpHome, authId: "work", name: "github.pat" })).toEqual({
      ref: null,
    });
  });
});

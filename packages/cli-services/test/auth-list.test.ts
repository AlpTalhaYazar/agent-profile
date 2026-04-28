/**
 * Tests for `authListService` — projects `authProfiles.yml` to the wire shape.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authListService } from "../src/auth/list.js";

describe("authListService", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(
      tmpdir(),
      `cli-svc-auth-list-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(join(tmpHome, "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns an empty profiles array when authProfiles.yml is missing", () => {
    const result = authListService({ home: tmpHome });
    expect(result.profiles).toEqual([]);
  });

  it("projects each profile to id/displayName/mode/secrets when includeRefs is false", () => {
    const yaml = `
version: 1
authProfiles:
  work:
    displayName: "Work (Acme Inc.)"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs:
      github.pat: keyring://github/work
      postgres.acme-prod: keyring://postgres/acme-prod
  personal:
    displayName: "Personal"
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/personal
    mcpSecretRefs: {}
`.trim();
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    const result = authListService({ home: tmpHome });
    expect(result.profiles).toHaveLength(2);

    const work = result.profiles.find((p) => p.id === "work");
    expect(work).toEqual({
      id: "work",
      displayName: "Work (Acme Inc.)",
      mode: "apiKey",
      secrets: ["github.pat", "postgres.acme-prod"],
    });
    expect(work?.refs).toBeUndefined();
    expect(work?.anthropicRef).toBeUndefined();

    const personal = result.profiles.find((p) => p.id === "personal");
    expect(personal).toEqual({
      id: "personal",
      displayName: "Personal",
      mode: "apiKey",
      secrets: [],
    });
  });

  it("includes refs map and anthropicRef when includeRefs is true", () => {
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

    const result = authListService({ home: tmpHome, includeRefs: true });
    expect(result.profiles).toHaveLength(1);
    const work = result.profiles[0];
    expect(work?.refs).toEqual({ "github.pat": "keyring://github/work" });
    expect(work?.anthropicRef).toBe("keyring://anthropic/work");
  });

  it("returns null displayName when none configured", () => {
    const yaml = `
version: 1
authProfiles:
  bare:
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/bare
    mcpSecretRefs: {}
`.trim();
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    const result = authListService({ home: tmpHome });
    expect(result.profiles[0]).toMatchObject({
      id: "bare",
      displayName: null,
      mode: "apiKey",
    });
  });
});

/**
 * Tests for `auth/profiles-file.ts`.
 * Covers load, save, round-trip, missing file, and schema error cases.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAuthProfiles, saveAuthProfiles } from "../src/auth/profiles-file.js";

describe("loadAuthProfiles", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `ap-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpHome, "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty default when file does not exist", () => {
    const doc = loadAuthProfiles(tmpHome);
    expect(doc.version).toBe(1);
    expect(doc.authProfiles).toEqual({});
  });

  it("parses a valid authProfiles.yml", () => {
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

    const doc = loadAuthProfiles(tmpHome);
    expect(doc.version).toBe(1);
    expect(doc.authProfiles.work).toBeDefined();
    expect(doc.authProfiles.work?.displayName).toBe("Work");
    expect(doc.authProfiles.work?.anthropic.mode).toBe("apiKey");
    expect(doc.authProfiles.work?.mcpSecretRefs["github.pat"]).toBe("keyring://github/work");
  });

  it("throws CliError (exit 2) on schema error", () => {
    const yaml = `
version: 1
authProfiles:
  work:
    anthropic:
      mode: invalid-mode
      secretRef: keyring://anthropic/work
`.trim();
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    expect(() => loadAuthProfiles(tmpHome)).toThrow();
    try {
      loadAuthProfiles(tmpHome);
    } catch (err: unknown) {
      expect((err as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("throws CliError on invalid YAML syntax", () => {
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), "{{ invalid yaml: [\n");

    expect(() => loadAuthProfiles(tmpHome)).toThrow();
    try {
      loadAuthProfiles(tmpHome);
    } catch (err: unknown) {
      expect((err as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("throws CliError when secretRef is missing keyring:// prefix", () => {
    const yaml = `
version: 1
authProfiles:
  work:
    anthropic:
      mode: apiKey
      secretRef: "not-a-keyring-uri"
`.trim();
    writeFileSync(join(tmpHome, "config", "authProfiles.yml"), yaml);

    expect(() => loadAuthProfiles(tmpHome)).toThrow();
  });
});

describe("saveAuthProfiles", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `ap-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpHome, "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes a file that can be read back (round-trip)", () => {
    const doc = {
      version: 1 as const,
      authProfiles: {
        test: {
          displayName: "Test Profile",
          anthropic: {
            mode: "apiKey" as const,
            secretRef: "keyring://anthropic/test",
          },
          mcpSecretRefs: {
            "github.pat": "keyring://github/test",
          },
        },
      },
    };

    saveAuthProfiles(doc, tmpHome);

    const loaded = loadAuthProfiles(tmpHome);
    expect(loaded.version).toBe(1);
    expect(loaded.authProfiles.test?.displayName).toBe("Test Profile");
    expect(loaded.authProfiles.test?.anthropic.mode).toBe("apiKey");
    expect(loaded.authProfiles.test?.mcpSecretRefs["github.pat"]).toBe("keyring://github/test");
  });

  it("creates parent directories if they do not exist", () => {
    const newHome = join(tmpHome, "nested", "home");
    const doc = {
      version: 1 as const,
      authProfiles: {},
    };

    saveAuthProfiles(doc, newHome);

    const loaded = loadAuthProfiles(newHome);
    expect(loaded.authProfiles).toEqual({});
  });

  it("overwrites an existing file atomically", () => {
    const doc1 = {
      version: 1 as const,
      authProfiles: {
        first: {
          anthropic: { mode: "apiKey" as const, secretRef: "keyring://anthropic/first" },
          mcpSecretRefs: {},
        },
      },
    };
    saveAuthProfiles(doc1, tmpHome);

    const doc2 = {
      version: 1 as const,
      authProfiles: {
        second: {
          anthropic: { mode: "bedrock" as const, secretRef: "keyring://anthropic/second" },
          mcpSecretRefs: {},
        },
      },
    };
    saveAuthProfiles(doc2, tmpHome);

    const loaded = loadAuthProfiles(tmpHome);
    expect(loaded.authProfiles.first).toBeUndefined();
    expect(loaded.authProfiles.second).toBeDefined();
    expect(loaded.authProfiles.second?.anthropic.mode).toBe("bedrock");
  });
});

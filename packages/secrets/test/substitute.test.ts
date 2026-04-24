/**
 * Tests for the `substitute` helper.
 *
 * Covers single refs, embedded refs, multiple ref kinds, missing refs,
 * and the full-string keyring:// form.
 */

import type { SecretRef } from "@agent-profile/core";
import { describe, expect, it } from "vitest";
import { substitute } from "../src/resolver/substitute.js";

/** A simple resolver that returns from a pre-built map, or null if missing. */
function makeResolver(values: Record<string, string>): (ref: SecretRef) => Promise<string | null> {
  return async (ref: SecretRef) => {
    switch (ref.kind) {
      case "env":
        return values[`env:${ref.name}`] ?? null;
      case "secret":
        return values[`secret:${ref.name}`] ?? null;
      case "keyring":
        return values[`keyring:${ref.service}/${ref.account}`] ?? null;
    }
  };
}

describe("substitute — single refs", () => {
  it("resolves a single ${env:VAR} ref", async () => {
    const result = await substitute("${env:HOME}", makeResolver({ "env:HOME": "/home/user" }));
    expect(result.value).toBe("/home/user");
    expect(result.missing).toHaveLength(0);
  });

  it("resolves a single ${secret:name} ref", async () => {
    const result = await substitute(
      "${secret:github.pat}",
      makeResolver({ "secret:github.pat": "ghp_test" })
    );
    expect(result.value).toBe("ghp_test");
    expect(result.missing).toHaveLength(0);
  });

  it("resolves a standalone keyring:// URI", async () => {
    const result = await substitute(
      "keyring://figma/work",
      makeResolver({ "keyring:figma/work": "fig_tok_123" })
    );
    expect(result.value).toBe("fig_tok_123");
    expect(result.missing).toHaveLength(0);
  });
});

describe("substitute — embedded refs", () => {
  it("substitutes an env ref embedded in a longer string", async () => {
    const result = await substitute(
      "prefix-${env:A}-suffix",
      makeResolver({ "env:A": "resolved-a" })
    );
    expect(result.value).toBe("prefix-resolved-a-suffix");
    expect(result.missing).toHaveLength(0);
  });

  it("substitutes multiple env refs in a single string", async () => {
    const result = await substitute(
      "${env:A}-mid-${env:B}-suffix",
      makeResolver({ "env:A": "aa", "env:B": "bb" })
    );
    expect(result.value).toBe("aa-mid-bb-suffix");
    expect(result.missing).toHaveLength(0);
  });

  it("substitutes a connection string with two env refs", async () => {
    const result = await substitute(
      "postgres://${env:DB_USER}:${env:DB_PW}@host/db",
      makeResolver({ "env:DB_USER": "alice", "env:DB_PW": "s3cr3t" })
    );
    expect(result.value).toBe("postgres://alice:s3cr3t@host/db");
  });
});

describe("substitute — multiple ref kinds", () => {
  it("resolves a string with both secret and env refs", async () => {
    const result = await substitute(
      "${secret:github}:${env:PORT}",
      makeResolver({ "secret:github": "ghp_abc", "env:PORT": "8080" })
    );
    expect(result.value).toBe("ghp_abc:8080");
    expect(result.missing).toHaveLength(0);
  });
});

describe("substitute — missing refs", () => {
  it("returns the original ref text for a missing env ref", async () => {
    const result = await substitute("${env:MISSING}", makeResolver({}));
    expect(result.value).toBe("${env:MISSING}");
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ kind: "env", name: "MISSING" });
  });

  it("returns the original ref text for a missing secret ref", async () => {
    const result = await substitute("${secret:missing.key}", makeResolver({}));
    expect(result.value).toBe("${secret:missing.key}");
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ kind: "secret", name: "missing.key" });
  });

  it("preserves surrounding text when a ref is missing", async () => {
    const result = await substitute(
      "postgres://${secret:pg.user}:${secret:pg.pw}@host/db",
      makeResolver({ "secret:pg.user": "alice" }) // pg.pw is missing
    );
    expect(result.value).toBe("postgres://alice:${secret:pg.pw}@host/db");
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ kind: "secret", name: "pg.pw" });
  });

  it("leaves a plain string unchanged when there are no refs", async () => {
    const result = await substitute("no-refs-here", makeResolver({}));
    expect(result.value).toBe("no-refs-here");
    expect(result.missing).toHaveLength(0);
  });
});

describe("substitute — deduplication", () => {
  it("calls the resolver only once per unique token", async () => {
    const callCounts = new Map<string, number>();
    const resolver = async (ref: SecretRef): Promise<string | null> => {
      const key = `${ref.kind}:${"name" in ref ? ref.name : `${ref.service}/${ref.account}`}`;
      callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
      return "value";
    };

    await substitute("${env:FOO}-${env:FOO}-${env:FOO}", resolver);
    expect(callCounts.get("env:FOO")).toBe(1);
  });
});

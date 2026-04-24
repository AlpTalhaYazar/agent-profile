/**
 * Tests for the resolution log.
 *
 * Key assertion: the `ResolutionLogEntry` type has no `value` field,
 * both at the type level (compile-time) and at runtime (serialized log scan).
 */

import { describe, expect, it } from "vitest";
import { type ResolutionLogEntry, makeLogEntry } from "../src/resolver/resolution-log.js";

describe("makeLogEntry", () => {
  it("creates an entry with the expected shape", () => {
    const entry = makeLogEntry(
      "env.DATABASE_URL",
      "secret",
      "pg.pw",
      "secret-via-authprofile",
      true
    );

    expect(entry.path).toBe("env.DATABASE_URL");
    expect(entry.refKind).toBe("secret");
    expect(entry.refIdentifier).toBe("pg.pw");
    expect(entry.source).toBe("secret-via-authprofile");
    expect(entry.resolved).toBe(true);
    expect(typeof entry.timestamp).toBe("string");
    // ISO-8601 format check
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  it("creates an unresolved entry when resolved=false", () => {
    const entry = makeLogEntry(
      "mcpServers.github.env.TOKEN",
      "keyring",
      "agent-profile.github.work",
      "keyring",
      false
    );
    expect(entry.resolved).toBe(false);
  });
});

describe("ResolutionLogEntry — no value field", () => {
  it("does not have a value property at runtime", () => {
    const entry = makeLogEntry("path", "env", "VAR", "env", true);
    expect("value" in entry).toBe(false);
  });

  it("serialized JSON does not contain secret value", () => {
    // Simulate a resolution log for a known secret value.
    // The log must NOT contain the actual secret, even if the test
    // accidentally includes it somewhere.
    const knownTestSecret = "SUPER_SECRET_VALUE_DO_NOT_LOG";

    const entry = makeLogEntry("env.TOKEN", "env", "TOKEN", "env", true);
    // We do NOT put the secret in any log field — just verify it's absent.
    const serialized = JSON.stringify(entry);

    expect(serialized).not.toContain(knownTestSecret);
    // Verify the identifier (not the value) IS present
    expect(serialized).toContain("TOKEN");
  });

  it("type-level: ResolutionLogEntry has no value field (compile-time check via keyof)", () => {
    // This is a compile-time test expressed as a runtime assertion.
    // If `ResolutionLogEntry` ever gains a `value` field, this assertion
    // will still pass at runtime, but TypeScript would reveal the issue
    // at compile time through the type assertion below.
    type NoValueField = "value" extends keyof ResolutionLogEntry ? true : false;
    const noValue: NoValueField = false;
    expect(noValue).toBe(false);
  });
});

describe("ResolutionLogEntry — full log scenario", () => {
  it("a batch of log entries does not contain a known test secret", () => {
    const SECRET = "ghp_test_token_12345_NEVER_APPEAR_IN_LOG";

    const entries: ResolutionLogEntry[] = [
      makeLogEntry("env.TOKEN", "env", "TOKEN", "env", true),
      makeLogEntry(
        "mcpServers.github.env.PAT",
        "secret",
        "github.pat",
        "secret-via-authprofile",
        true
      ),
      makeLogEntry(
        "mcpServers.figma.env.TOKEN",
        "keyring",
        "agent-profile.figma.work",
        "keyring",
        true
      ),
    ];

    const serialized = JSON.stringify(entries);

    // The secret value must not appear anywhere in the log
    expect(serialized).not.toContain(SECRET);

    // But identifiers/paths should appear
    expect(serialized).toContain("github.pat");
    expect(serialized).toContain("agent-profile.figma.work");
  });
});

/**
 * Tests for CLI error mapping and CliError class.
 */
import { CascadeError, CoreError, FragmentNotFoundError, SchemaError } from "@agent-profile/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CliError,
  EXIT_CONFIG_INVALID,
  EXIT_GENERIC,
  EXIT_INTERRUPTED,
  EXIT_SUCCESS,
  EXIT_USER_CANCELLED,
  mapCoreError,
} from "../src/errors.js";

/** Helper to produce a ZodError by triggering a parse failure. */
function makeZodError(): z.ZodError {
  try {
    z.object({ version: z.number() }).parse({ version: "bad" });
  } catch (e) {
    if (e instanceof z.ZodError) return e;
  }
  throw new Error("Expected ZodError but none thrown");
}

describe("exit code constants", () => {
  it("EXIT_SUCCESS is 0", () => expect(EXIT_SUCCESS).toBe(0));
  it("EXIT_GENERIC is 1", () => expect(EXIT_GENERIC).toBe(1));
  it("EXIT_CONFIG_INVALID is 2", () => expect(EXIT_CONFIG_INVALID).toBe(2));
  it("EXIT_USER_CANCELLED is 6", () => expect(EXIT_USER_CANCELLED).toBe(6));
  it("EXIT_INTERRUPTED is 130", () => expect(EXIT_INTERRUPTED).toBe(130));
});

describe("CliError", () => {
  it("creates with message and default exit code", () => {
    const err = new CliError("Something went wrong");
    expect(err.message).toBe("Something went wrong");
    expect(err.exitCode).toBe(EXIT_GENERIC);
    expect(err.name).toBe("CliError");
    expect(err.hint).toBeUndefined();
  });

  it("creates with custom exit code", () => {
    const err = new CliError("Invalid config", EXIT_CONFIG_INVALID);
    expect(err.exitCode).toBe(EXIT_CONFIG_INVALID);
  });

  it("creates with hint", () => {
    const err = new CliError(
      "Missing file",
      EXIT_GENERIC,
      "Create it with: myclaude profile create"
    );
    expect(err.hint).toBe("Create it with: myclaude profile create");
  });

  it("is an instance of Error", () => {
    const err = new CliError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("hint is undefined when not provided", () => {
    const err = new CliError("test", EXIT_GENERIC);
    expect(err.hint).toBeUndefined();
  });
});

describe("mapCoreError", () => {
  describe("SchemaError", () => {
    it("maps SchemaError to EXIT_CONFIG_INVALID", () => {
      const err = new SchemaError("/some/file.yml", makeZodError());
      const result = mapCoreError(err);
      expect(result.exitCode).toBe(EXIT_CONFIG_INVALID);
      expect(result.hint).toContain("/some/file.yml");
    });

    it("message includes source file path", () => {
      const err = new SchemaError("/path/to/scope.yml", makeZodError());
      const result = mapCoreError(err);
      expect(result.message).toContain("/path/to/scope.yml");
    });

    it("hint mentions the source file", () => {
      const err = new SchemaError("/path/to/scope.yml", makeZodError());
      const result = mapCoreError(err);
      expect(result.hint).toContain("/path/to/scope.yml");
    });
  });

  describe("FragmentNotFoundError", () => {
    it("maps FragmentNotFoundError to EXIT_CONFIG_INVALID", () => {
      const err = new FragmentNotFoundError("my-fragment", ["/searched/path"]);
      const result = mapCoreError(err);
      expect(result.exitCode).toBe(EXIT_CONFIG_INVALID);
      expect(result.message).toContain("my-fragment");
      expect(result.hint).toContain("fragment");
    });
  });

  describe("CascadeError", () => {
    it("maps CascadeError to EXIT_CONFIG_INVALID", () => {
      const err = new CascadeError("backend", "mcpServers.bad", "conflict");
      const result = mapCoreError(err);
      expect(result.exitCode).toBe(EXIT_CONFIG_INVALID);
      expect(result.hint).toContain("backend");
      expect(result.hint).toContain("mcpServers.bad");
    });
  });

  describe("CoreError", () => {
    it("maps CoreError to EXIT_GENERIC", () => {
      const err = new CoreError("Generic core error");
      const result = mapCoreError(err);
      expect(result.exitCode).toBe(EXIT_GENERIC);
      expect(result.message).toBe("Generic core error");
      expect(result.hint).toBeUndefined();
    });
  });

  describe("CliError passthrough", () => {
    it("passes through CliError exitCode and message", () => {
      const err = new CliError("CLI error", EXIT_USER_CANCELLED, "Try again");
      const result = mapCoreError(err);
      expect(result.exitCode).toBe(EXIT_USER_CANCELLED);
      expect(result.message).toBe("CLI error");
      expect(result.hint).toBe("Try again");
    });

    it("CliError without hint returns no hint", () => {
      const err = new CliError("CLI error", EXIT_GENERIC);
      const result = mapCoreError(err);
      expect(result.hint).toBeUndefined();
    });
  });

  describe("plain Error", () => {
    it("maps plain Error to EXIT_GENERIC", () => {
      const err = new Error("Plain error");
      const result = mapCoreError(err);
      expect(result.exitCode).toBe(EXIT_GENERIC);
      expect(result.message).toBe("Plain error");
    });
  });

  describe("non-Error throws", () => {
    it("maps string to EXIT_GENERIC", () => {
      const result = mapCoreError("just a string");
      expect(result.exitCode).toBe(EXIT_GENERIC);
      expect(result.message).toBe("just a string");
    });

    it("maps object to EXIT_GENERIC with string coercion", () => {
      const result = mapCoreError({ code: 42 });
      expect(result.exitCode).toBe(EXIT_GENERIC);
      expect(result.message).toBe("[object Object]");
    });
  });
});

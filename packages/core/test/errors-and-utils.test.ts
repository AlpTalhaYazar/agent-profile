import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CascadeError, FragmentNotFoundError, SchemaError } from "../src/errors.js";
import { ScopeDoc } from "../src/schema/index.js";
import { loadScopeFile, loadYamlAs, readYamlFile } from "../src/utils/load-yaml.js";

describe("SchemaError", () => {
  it("includes source file in error message", () => {
    const { error } = ScopeDoc.safeParse({ version: 2 }) as {
      success: false;
      error: import("zod").ZodError;
    };
    const err = new SchemaError("/path/to/file.yml", error);
    expect(err.message).toContain("/path/to/file.yml");
    expect(err.sourceFile).toBe("/path/to/file.yml");
    expect(err.name).toBe("SchemaError");
  });

  it("includes field path in error message", () => {
    const { error } = ScopeDoc.safeParse({ version: 2 }) as {
      success: false;
      error: import("zod").ZodError;
    };
    const err = new SchemaError("/path/to/file.yml", error);
    expect(err.message).toContain("version");
  });

  it("exposes zodError", () => {
    const { error } = ScopeDoc.safeParse({ version: 2 }) as {
      success: false;
      error: import("zod").ZodError;
    };
    const err = new SchemaError("/path/to/file.yml", error);
    expect(err.zodError).toBeDefined();
  });
});

describe("FragmentNotFoundError", () => {
  it("includes fragment name and searched paths", () => {
    const err = new FragmentNotFoundError("my-fragment", [
      "/path/a/my-fragment.yml",
      "/path/b/my-fragment.yml",
    ]);
    expect(err.message).toContain("my-fragment");
    expect(err.message).toContain("/path/a/my-fragment.yml");
    expect(err.fragmentName).toBe("my-fragment");
    expect(err.searchedPaths).toHaveLength(2);
    expect(err.name).toBe("FragmentNotFoundError");
  });
});

describe("CascadeError", () => {
  it("includes scope name and field path", () => {
    const err = new CascadeError(
      "global-role",
      "mcpServers.postgres.__extends",
      "target not found"
    );
    expect(err.message).toContain("global-role");
    expect(err.message).toContain("mcpServers.postgres.__extends");
    expect(err.scopeName).toBe("global-role");
    expect(err.fieldPath).toBe("mcpServers.postgres.__extends");
    expect(err.name).toBe("CascadeError");
  });
});

describe("loadYamlAs", () => {
  it("loads and validates a scope document", () => {
    const tmpFile = join(tmpdir(), `load-yaml-test-${Date.now()}.yml`);
    writeFileSync(tmpFile, "version: 1\n");
    const doc = loadYamlAs(tmpFile, ScopeDoc);
    expect(doc.version).toBe(1);
  });

  it("throws SchemaError for invalid YAML doc", () => {
    const tmpFile = join(tmpdir(), `load-yaml-invalid-${Date.now()}.yml`);
    writeFileSync(tmpFile, "version: 99\n");
    expect(() => loadYamlAs(tmpFile, ScopeDoc)).toThrow(SchemaError);
  });
});

describe("readYamlFile", () => {
  it("reads and parses a YAML file to a plain object", () => {
    const tmpFile = join(tmpdir(), `read-yaml-test-${Date.now()}.yml`);
    writeFileSync(tmpFile, "key: value\nnested:\n  foo: bar\n");
    const result = readYamlFile(tmpFile);
    expect(result).toEqual({ key: "value", nested: { foo: "bar" } });
  });

  it("throws an error for a non-existent file", () => {
    expect(() => readYamlFile("/nonexistent/path/file.yml")).toThrow();
  });
});

describe("loadScopeFile", () => {
  it("returns doc and rawYaml for a valid file", () => {
    const tmpFile = join(tmpdir(), `scope-file-test-${Date.now()}.yml`);
    writeFileSync(tmpFile, "version: 1\nenv:\n  FOO: bar\n");
    const { doc, rawYaml } = loadScopeFile(tmpFile);
    expect(doc.version).toBe(1);
    expect(doc.env.FOO).toBe("bar");
    expect(rawYaml).toContain("version: 1");
  });

  it("throws SchemaError for invalid scope doc", () => {
    const tmpFile = join(tmpdir(), `scope-invalid-${Date.now()}.yml`);
    writeFileSync(tmpFile, "version: 2\n");
    expect(() => loadScopeFile(tmpFile)).toThrow(SchemaError);
  });
});

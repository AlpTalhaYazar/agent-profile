import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { SchemaError } from "../errors.js";
import type { ScopeDocT } from "../schema/index.js";
import { ScopeDoc } from "../schema/index.js";

/**
 * The result of loading a YAML scope file.
 */
export interface LoadedYaml<T> {
  /** The parsed and Zod-validated document. */
  doc: T;
  /** The raw YAML string (useful for source maps / line-number error reporting). */
  rawYaml: string;
}

/**
 * Reads a YAML file from disk and returns its parsed content as a plain object.
 * Does NOT validate against any schema — callers are responsible for that.
 *
 * Throws a native `Error` if the file cannot be read or if YAML syntax is invalid.
 */
export function readYamlFile(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf8");
  return parseYaml(raw);
}

/**
 * Loads a scope YAML file from disk and validates it against `ScopeDoc`.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns The validated scope document.
 * @throws {SchemaError} If the YAML fails Zod validation.
 * @throws {Error} If the file cannot be read or YAML is malformed.
 */
export function loadScopeFile(filePath: string): LoadedYaml<ScopeDocT> {
  const rawYaml = readFileSync(filePath, "utf8");
  const parsed = parseYaml(rawYaml);
  const result = ScopeDoc.safeParse(parsed);
  if (!result.success) {
    throw new SchemaError(filePath, result.error);
  }
  return { doc: result.data, rawYaml };
}

/**
 * Loads and validates any YAML file using a provided Zod schema.
 * Generic utility for fragment files and auth profiles.
 *
 * @param filePath - Absolute path to the YAML file.
 * @param schema - Zod schema to validate against.
 * @returns The validated document.
 * @throws {SchemaError} If the YAML fails Zod validation.
 */
export function loadYamlAs<T>(
  filePath: string,
  schema: {
    safeParse: (
      input: unknown
    ) => { success: true; data: T } | { success: false; error: import("zod").ZodError };
  }
): T {
  const rawYaml = readFileSync(filePath, "utf8");
  const parsed = parseYaml(rawYaml);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new SchemaError(filePath, result.error);
  }
  return result.data;
}

/**
 * @module commands/profile/validate
 *
 * `myclaude profile validate [path]`
 *
 * Zod-validates one file (when a path is given) or all discovered scope files.
 * Exits with code 2 if any file fails validation.
 */
import { existsSync } from "node:fs";
import { loadScopeFile } from "@agent-profile/core";
import { defineCommand } from "citty";
import { CliError, EXIT_CONFIG_INVALID, EXIT_GENERIC, mapCoreError } from "../../errors.js";
import { green, red } from "../../output/colors.js";
import { writeJson } from "../../output/json.js";
import { discoverScopes } from "../../utils/scope-discovery.js";

/**
 * Validation result for a single file.
 */
interface ValidationResult {
  /** Absolute file path. */
  filePath: string;
  /** Whether validation succeeded. */
  valid: boolean;
  /** Error message if invalid. */
  error?: string;
}

/**
 * Validates a single YAML file against the ScopeDoc schema.
 */
function validateFile(filePath: string): ValidationResult {
  try {
    loadScopeFile(filePath);
    return { filePath, valid: true };
  } catch (err) {
    const mapped = mapCoreError(err);
    return { filePath, valid: false, error: mapped.message };
  }
}

/**
 * `myclaude profile validate` command definition.
 */
export const profileValidateCommand = defineCommand({
  meta: {
    name: "validate",
    description: "Validate scope YAML files with Zod",
  },
  args: {
    path: {
      type: "positional",
      description: "Path to a specific scope file (default: all discovered scopes)",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON to stdout",
      alias: "j",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty-print JSON output (implies --json)",
      default: false,
    },
    home: {
      type: "string",
      description: "Override myclaude home directory (for testing)",
    },
    cwd: {
      type: "string",
      description: "Override working directory (for testing)",
    },
  },
  run({ args }) {
    const jsonMode = Boolean(args.json) || Boolean(args.pretty);
    const pretty = Boolean(args.pretty);
    const results: ValidationResult[] = [];

    if (args.path) {
      // Validate a single file
      if (!existsSync(args.path)) {
        throw new CliError(`File not found: ${args.path}`, EXIT_GENERIC);
      }
      results.push(validateFile(args.path));
    } else {
      // Validate all discovered scopes
      const entries = discoverScopes({ home: args.home, cwd: args.cwd });
      if (entries.length === 0) {
        if (jsonMode) {
          writeJson({ results: [], allValid: true }, pretty);
          return;
        }
        process.stdout.write("No scope files found.\n");
        return;
      }
      for (const entry of entries) {
        results.push(validateFile(entry.filePath));
      }
    }

    const allValid = results.every((r) => r.valid);

    if (jsonMode) {
      writeJson({ results, allValid }, pretty);
      if (!allValid) process.exit(EXIT_CONFIG_INVALID);
      return;
    }

    for (const result of results) {
      if (result.valid) {
        process.stdout.write(`${green("[✓]")} ${result.filePath}\n`);
      } else {
        process.stderr.write(`${red("[✗]")} ${result.filePath}\n`);
        if (result.error) {
          for (const line of result.error.split("\n")) {
            process.stderr.write(`     ${line}\n`);
          }
        }
      }
    }

    if (!allValid) {
      process.exit(EXIT_CONFIG_INVALID);
    }
  },
});

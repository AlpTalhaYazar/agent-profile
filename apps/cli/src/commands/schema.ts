/**
 * @module commands/schema
 *
 * `myclaude schema export [path]`
 *
 * Dumps the Zod-derived JSON Schema for `ScopeDoc`.
 * - No path: prints to stdout.
 * - With path: writes to disk with 0644 permissions.
 * - Default target when path is omitted and `--write` is given: `~/.myclaude/schema.json`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScopeDoc } from "@agent-profile/core";
import { defineCommand } from "citty";
import { z } from "zod";
import { CliError, EXIT_GENERIC } from "../errors.js";
import { myClaudeHome } from "../utils/paths.js";

/**
 * Generates the JSON Schema from the `ScopeDoc` Zod schema.
 *
 * @returns JSON Schema object.
 */
export function generateJsonSchema(): Record<string, unknown> {
  // z.toJSONSchema is available in Zod v4
  return z.toJSONSchema(ScopeDoc) as Record<string, unknown>;
}

/**
 * `myclaude schema` parent command (with `export` sub-command).
 */
export const schemaCommand = defineCommand({
  meta: {
    name: "schema",
    description: "Schema utilities",
  },
  subCommands: {
    export: defineCommand({
      meta: {
        name: "export",
        description: "Write Zod-derived JSON Schema for IDE integration",
      },
      args: {
        path: {
          type: "positional",
          description: "Output path (default: stdout; use --write for ~/.myclaude/schema.json)",
          required: false,
        },
        write: {
          type: "boolean",
          description: "Write to ~/.myclaude/schema.json (default target)",
          default: false,
        },
        pretty: {
          type: "boolean",
          description: "Pretty-print JSON output",
          default: true,
        },
        home: {
          type: "string",
          description: "Override myclaude home directory (for testing)",
        },
      },
      run({ args }) {
        const schema = generateJsonSchema();
        const indent = args.pretty ? 2 : 0;
        const json = JSON.stringify(schema, null, indent);

        // args.path / args.write / args.home may be string | boolean | string[] from citty
        const rawPath = typeof args.path === "string" ? args.path : null;
        const rawWrite = typeof args.write === "boolean" ? args.write : Boolean(args.write);
        const rawHome = typeof args.home === "string" ? args.home : undefined;

        let outPath: string | null = rawPath;

        if (!outPath && rawWrite) {
          outPath = join(rawHome ?? myClaudeHome(), "schema.json");
        }

        if (outPath) {
          try {
            writeFileSync(outPath, `${json}\n`, { encoding: "utf8", mode: 0o644 });
            process.stdout.write(`Schema written to ${outPath}\n`);
          } catch (err) {
            throw new CliError(
              `Failed to write schema to ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
              EXIT_GENERIC
            );
          }
        } else {
          process.stdout.write(`${json}\n`);
        }
      },
    }),
  },
});

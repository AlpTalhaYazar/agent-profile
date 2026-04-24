/**
 * @module commands/profile/list
 *
 * `myclaude profile list [--role <r>] [--json]`
 *
 * Enumerates all discoverable scope files from the global config directory
 * and the project chain found from the current working directory.
 */
import { defineCommand } from "citty";
import { formatListHeader, formatListRow } from "../../output/format.js";
import { writeJson } from "../../output/json.js";
import { discoverScopes } from "../../utils/scope-discovery.js";

/**
 * `myclaude profile list` command definition.
 */
export const profileListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all profile scope files",
  },
  args: {
    role: {
      type: "string",
      description: "Filter to scopes contributing to this role",
      alias: "r",
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON",
      alias: "j",
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
    const entries = discoverScopes({
      home: args.home,
      cwd: args.cwd,
      filterRole: args.role,
    });

    if (args.json) {
      writeJson(entries);
      return;
    }

    process.stdout.write(`${formatListHeader()}\n`);
    for (const entry of entries) {
      process.stdout.write(`${formatListRow(entry.scope, entry.role, entry.filePath)}\n`);
    }
  },
});

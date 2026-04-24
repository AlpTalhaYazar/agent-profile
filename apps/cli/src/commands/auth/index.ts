/**
 * @module commands/auth
 *
 * `myclaude auth` parent command.
 *
 * Sub-commands:
 * - `list`   — list auth profiles
 * - `add`    — create a new auth profile
 * - `set`    — set/update a single MCP secret
 * - `rotate` — rotate the Anthropic secret
 * - `remove` — delete an auth profile
 */
import { defineCommand } from "citty";
import { authAddCommand } from "./add.js";
import { authListCommand } from "./list.js";
import { authRemoveCommand } from "./remove.js";
import { authRotateCommand } from "./rotate.js";
import { authSetCommand } from "./set.js";

/**
 * `myclaude auth` parent command definition.
 */
export const authCommand = defineCommand({
  meta: {
    name: "auth",
    description: "Manage auth profiles and credentials",
  },
  subCommands: {
    list: authListCommand,
    add: authAddCommand,
    set: authSetCommand,
    rotate: authRotateCommand,
    remove: authRemoveCommand,
  },
});

export { authListCommand, authAddCommand, authSetCommand, authRotateCommand, authRemoveCommand };

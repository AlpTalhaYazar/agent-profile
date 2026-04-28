/**
 * @module commands/secrets
 *
 * Group dispatcher for the `myclaude secrets …` commands.
 *
 * Currently exposes only `migrate`. Future subcommands (e.g. `audit`, `list`)
 * land under this group.
 */

import { defineCommand } from "citty";
import { secretsMigrateCommand } from "./migrate.js";

export const secretsCommand = defineCommand({
  meta: {
    name: "secrets",
    description: "Operations on stored secrets",
  },
  subCommands: {
    migrate: secretsMigrateCommand,
  },
});

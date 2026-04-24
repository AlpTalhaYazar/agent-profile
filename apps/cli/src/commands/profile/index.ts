/**
 * @module commands/profile
 *
 * Parent `profile` command. Groups the sub-commands:
 * - list
 * - show
 * - create
 * - edit
 * - validate
 */
import { defineCommand } from "citty";
import { profileCreateCommand } from "./create.js";
import { profileEditCommand } from "./edit.js";
import { profileListCommand } from "./list.js";
import { profileShowCommand } from "./show.js";
import { profileValidateCommand } from "./validate.js";

/**
 * `myclaude profile` parent command.
 */
export const profileCommand = defineCommand({
  meta: {
    name: "profile",
    description: "Manage role profile scope files",
  },
  subCommands: {
    list: profileListCommand,
    show: profileShowCommand,
    create: profileCreateCommand,
    edit: profileEditCommand,
    validate: profileValidateCommand,
  },
});

export {
  profileListCommand,
  profileShowCommand,
  profileCreateCommand,
  profileEditCommand,
  profileValidateCommand,
};

/**
 * @module commands/profile/edit
 *
 * `myclaude profile edit <role> [--global|--project]`
 *
 * Opens the matching scope file in `$EDITOR`.
 * If the file doesn't exist, offers to create it first (or exits with hint).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "citty";
import { CliError, EXIT_GENERIC } from "../../errors.js";
import { openInEditor } from "../../utils/editor.js";
import { globalRolesDir, myClaudeHome } from "../../utils/paths.js";
import { runCreate } from "./create.js";

/**
 * `myclaude profile edit <role>` command definition.
 */
export const profileEditCommand = defineCommand({
  meta: {
    name: "edit",
    description: "Open a role scope file in $EDITOR",
  },
  args: {
    role: {
      type: "positional",
      description: "Role name",
      required: true,
    },
    global: {
      type: "boolean",
      description: "Edit global scope (~/.myclaude/config/global/roles/)",
      default: false,
    },
    project: {
      type: "boolean",
      description: "Edit project scope (<cwd>/.myclaude/roles/)",
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
  async run({ args }) {
    if (!args.role) {
      throw new CliError("Role argument is required", EXIT_GENERIC);
    }

    const home = args.home ?? myClaudeHome();
    const cwd = args.cwd ?? process.cwd();
    let targetPath: string;

    if (args.global) {
      targetPath = join(globalRolesDir(home), `${args.role}.yml`);
    } else if (args.project) {
      targetPath = join(cwd, ".myclaude", "roles", `${args.role}.yml`);
    } else {
      // Prefer global if it exists; fall back to project; then error
      const globalPath = join(globalRolesDir(home), `${args.role}.yml`);
      const projectPath = join(cwd, ".myclaude", "roles", `${args.role}.yml`);
      if (existsSync(globalPath)) {
        targetPath = globalPath;
      } else if (existsSync(projectPath)) {
        targetPath = projectPath;
      } else {
        throw new CliError(
          `No scope file found for role "${args.role}".`,
          EXIT_GENERIC,
          `Create it first: myclaude profile create ${args.role} --global`
        );
      }
    }

    if (!existsSync(targetPath)) {
      // Offer to create (non-interactive: just hint)
      if (!process.stdout.isTTY || process.env.CI) {
        throw new CliError(
          `File does not exist: ${targetPath}`,
          EXIT_GENERIC,
          `Create it first: myclaude profile create ${args.role} ${args.global ? "--global" : "--project"}`
        );
      }
      // Interactive: create first then open
      await runCreate({
        role: args.role,
        global: args.global,
        project: args.project || !args.global,
        home: args.home,
        cwd: args.cwd,
      });
    }

    openInEditor(targetPath);
  },
});

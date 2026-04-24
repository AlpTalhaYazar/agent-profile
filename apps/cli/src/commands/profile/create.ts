/**
 * @module commands/profile/create
 *
 * `myclaude profile create <role> [--global|--project]`
 *
 * Scaffolds an empty scope YAML file with a `$schema` header.
 * - `--global` → `~/.myclaude/config/global/roles/<role>.yml`
 * - `--project` → `<cwd>/.myclaude/roles/<role>.yml`
 * - Neither + non-TTY/CI → exit 1 with actionable message
 * - Neither + TTY → delegates to injected `ask` function (for testability)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { stringify as stringifyYaml } from "yaml";
import { CliError, EXIT_GENERIC, EXIT_USER_CANCELLED } from "../../errors.js";
import { writeJson } from "../../output/json.js";
import { globalRolesDir, myClaudeHome } from "../../utils/paths.js";

/** The schema URL used as the `$schema` field in scaffolded files. */
const SCHEMA_URL = "https://agent-profile.dev/schema/scope-doc.json";

/**
 * Generates the YAML content for a new empty scope file.
 *
 * @param role - Role name for the comment header.
 * @returns YAML string with schema header and empty template.
 */
export function scaffoldYaml(role: string): string {
  const doc = {
    $schema: SCHEMA_URL,
    version: 1,
    mcpServers: {},
    env: {},
    settings: {},
  };
  const yaml = stringifyYaml(doc, { lineWidth: 100 });
  return `# Agent Profile — ${role} scope\n# Edit this file to add MCP servers, env vars, and settings.\n\n${yaml}`;
}

/**
 * Options for the create logic (injectable for tests).
 */
export interface CreateOptions {
  role: string;
  global?: boolean;
  project?: boolean;
  force?: boolean;
  json?: boolean;
  pretty?: boolean;
  home?: string;
  cwd?: string;
  /**
   * Injectable prompt function used when neither --global nor --project is given
   * and the terminal is interactive. Receives the two choices and returns a
   * Promise resolving to `"global"`, `"project"`, or `"cancel"`.
   */
  ask?: () => Promise<"global" | "project" | "cancel">;
}

/**
 * Core logic for `profile create`. Separated for testability.
 *
 * @param opts - Create options.
 * @throws {CliError} On conflicts or user cancellation.
 */
export async function runCreate(opts: CreateOptions): Promise<void> {
  const { role, force = false, pretty = false } = opts;
  const json = Boolean(opts.json) || pretty;
  const home = opts.home ?? myClaudeHome();
  const cwd = opts.cwd ?? process.cwd();

  let targetPath: string;

  if (opts.global) {
    targetPath = join(globalRolesDir(home), `${role}.yml`);
  } else if (opts.project) {
    targetPath = join(cwd, ".myclaude", "roles", `${role}.yml`);
  } else {
    const askFn = opts.ask;
    // If an `ask` function is provided (test injection), use it directly.
    // Otherwise, check if we're in interactive mode.
    if (!askFn) {
      const isInteractive = process.stdout.isTTY && !process.env.CI && !json;
      if (!isInteractive) {
        throw new CliError(
          "Specify --global or --project when not in interactive mode.",
          EXIT_GENERIC,
          "Re-run with: myclaude profile create <role> --global"
        );
      }
      // Interactive but no ask function — shouldn't happen in practice
      throw new CliError(
        "Specify --global or --project when not in interactive mode.",
        EXIT_GENERIC
      );
    }

    const choice = await askFn();
    if (choice === "cancel") {
      throw new CliError("Cancelled.", EXIT_USER_CANCELLED);
    }
    targetPath =
      choice === "global"
        ? join(globalRolesDir(home), `${role}.yml`)
        : join(cwd, ".myclaude", "roles", `${role}.yml`);
  }

  if (existsSync(targetPath) && !force) {
    throw new CliError(
      `File already exists: ${targetPath}`,
      EXIT_GENERIC,
      "Re-run with --force to overwrite."
    );
  }

  // Create parent directories
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, scaffoldYaml(role), "utf8");

  if (json) {
    writeJson({ created: targetPath }, pretty);
    return;
  }

  process.stdout.write(`Created ${targetPath}\n`);
  process.stdout.write(`Edit it with: myclaude profile edit ${role}\n`);
}

/**
 * `myclaude profile create <role>` command definition.
 */
export const profileCreateCommand = defineCommand({
  meta: {
    name: "create",
    description: "Scaffold a new role scope file",
  },
  args: {
    role: {
      type: "positional",
      description: "Role name",
      required: true,
    },
    global: {
      type: "boolean",
      description: "Create in global config (~/.myclaude/config/global/roles/)",
      default: false,
    },
    project: {
      type: "boolean",
      description: "Create in project config (<cwd>/.myclaude/roles/)",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Overwrite an existing file",
      default: false,
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
  async run({ args }) {
    if (!args.role) {
      throw new CliError("Role argument is required", EXIT_GENERIC);
    }
    await runCreate({
      role: args.role,
      global: args.global,
      project: args.project,
      force: args.force,
      json: args.json,
      pretty: args.pretty,
      home: args.home,
      cwd: args.cwd,
    });
  },
});

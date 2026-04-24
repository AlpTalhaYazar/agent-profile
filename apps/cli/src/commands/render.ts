/**
 * @module commands/render
 *
 * `myclaude render [--role <r>] [--auth <a>] [--json] [--provenance]
 *   [--resolve-secrets [--show-values]]`
 *
 * Alias of `profile show` for the common debugging shape.
 * Resolves the cascade and prints effective config without spawning `claude`.
 *
 * Role resolution uses the activation resolver when `--role` is not given.
 */
import { defineCommand } from "citty";
import { NO_ROLE_HELP, resolveActivation } from "../activation/resolve.js";
import { CliError, EXIT_GENERIC } from "../errors.js";
import { runShow } from "./profile/show.js";

/**
 * `myclaude render` command definition.
 */
export const renderCommand = defineCommand({
  meta: {
    name: "render",
    description: "Dump effective config for a role (alias of profile show)",
  },
  args: {
    role: {
      type: "string",
      description: "Role name (or resolved from activation state)",
      alias: "r",
    },
    auth: {
      type: "string",
      description: "Auth profile ID",
      alias: "a",
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON",
      alias: "j",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty-print JSON output",
      default: false,
    },
    provenance: {
      type: "boolean",
      description: "Show provenance chain for each entry",
      default: false,
    },
    "resolve-secrets": {
      type: "boolean",
      description: "Resolve secret references from the keychain",
      default: false,
    },
    "show-values": {
      type: "boolean",
      description: "Show actual secret values (implies --resolve-secrets)",
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
    // Resolve role and auth from activation system when not provided as flags
    const activation = resolveActivation({
      flagRole: args.role,
      flagAuth: args.auth,
      cwd: args.cwd,
      home: args.home,
    });

    if (!activation.role) {
      throw new CliError(NO_ROLE_HELP, EXIT_GENERIC);
    }

    await runShow({
      role: activation.role,
      auth: activation.auth ?? args.auth,
      json: args.json,
      pretty: args.pretty,
      provenance: args.provenance,
      resolveSecrets: args["resolve-secrets"] || args["show-values"],
      showValues: args["show-values"],
      home: args.home,
      cwd: args.cwd,
    });
  },
});

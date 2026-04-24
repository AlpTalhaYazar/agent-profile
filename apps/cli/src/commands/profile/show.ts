/**
 * @module commands/profile/show
 *
 * `myclaude profile show <role> [--auth <id>] [--json] [--provenance]`
 *
 * Resolves the cascade for the given role and prints the effective config.
 * Shared implementation is used by both `profile show` and `render`.
 */
import { type EffectiveSessionConfig, resolve as coreResolve } from "@agent-profile/core";
import { defineCommand } from "citty";
import { CliError, EXIT_CONFIG_INVALID, mapCoreError } from "../../errors.js";
import { formatEffectiveConfig } from "../../output/format.js";
import { writeJson } from "../../output/json.js";
import { globalConfigDir, globalFragmentsDir } from "../../utils/paths.js";

/**
 * Options for the shared show/render logic.
 */
export interface ShowOptions {
  role: string;
  auth?: string;
  json?: boolean;
  provenance?: boolean;
  home?: string;
  cwd?: string;
  pretty?: boolean;
}

/**
 * Shared implementation for `profile show` and `render`.
 * Resolves the cascade and either prints human output or JSON.
 *
 * @param opts - Show options.
 * @throws {CliError} If the role cannot be resolved.
 */
export function runShow(opts: ShowOptions): void {
  const { role, auth, json = false, provenance = false, home, cwd, pretty = false } = opts;

  let result: EffectiveSessionConfig;
  try {
    const resolveInput: Parameters<typeof coreResolve>[0] = {
      role,
      cwd: cwd ?? process.cwd(),
      globalConfigDir: globalConfigDir(home),
      fragmentDirs: [globalFragmentsDir(home)],
    };
    if (auth !== undefined) resolveInput.authProfileId = auth;
    result = coreResolve(resolveInput);
  } catch (err) {
    const mapped = mapCoreError(err);
    throw new CliError(mapped.message, mapped.exitCode, mapped.hint);
  }

  if (json) {
    writeJson(
      {
        effective: result.effective,
        provenance: result.provenance,
      },
      pretty
    );
    return;
  }

  const formatted = formatEffectiveConfig(result, role, auth, {
    provenance,
    cwd: cwd ?? process.cwd(),
  });
  process.stdout.write(`${formatted}\n`);
}

/**
 * `myclaude profile show <role>` command definition.
 */
export const profileShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Print effective config for a role",
  },
  args: {
    role: {
      type: "positional",
      description: "Role name",
      required: true,
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
    if (!args.role) {
      throw new CliError("Role argument is required", EXIT_CONFIG_INVALID);
    }
    runShow({
      role: args.role,
      auth: args.auth,
      json: args.json,
      pretty: args.pretty,
      provenance: args.provenance,
      home: args.home,
      cwd: args.cwd,
    });
  },
});

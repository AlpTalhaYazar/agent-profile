/**
 * @module commands/profile/show
 *
 * `myclaude profile show <role> [--auth <id>] [--json] [--provenance]
 *   [--resolve-secrets [--show-values]]`
 *
 * Resolves the cascade for the given role and prints the effective config.
 * Shared implementation is used by both `profile show` and `render`.
 *
 * With `--resolve-secrets`, runs `resolveSecrets` after cascade and
 * replaces sensitive fields with `«redacted»` (unless `--show-values` is set).
 */
import {
  type EffectiveConfig,
  type EffectiveSessionConfig,
  type ScopeDocT,
  resolve as coreResolve,
} from "@agent-profile/core";
import type { Backend } from "@agent-profile/secrets";
import { BackendUnsafeError, getBackend, resolveSecrets } from "@agent-profile/secrets";
import { defineCommand } from "citty";
import { loadAuthProfiles } from "../../auth/profiles-file.js";
import { CliError, EXIT_CONFIG_INVALID, mapCoreError } from "../../errors.js";
import { formatEffectiveConfig, renderResolved } from "../../output/format.js";
import { writeJson } from "../../output/json.js";
import { globalConfigDir, globalFragmentsDir } from "../../utils/paths.js";

/**
 * Adapts an `EffectiveConfig` to a `ScopeDocT` so it can be passed to
 * `resolveSecrets`. The cascade engine produces `EffectiveConfig` which has
 * a compatible structure but lacks `version`, `use`, and `disabledServers`.
 *
 * @internal
 */
function effectiveConfigToScopeDoc(config: EffectiveConfig): ScopeDocT {
  return {
    version: 1,
    mcpServers: config.mcpServers,
    env: config.env,
    settings: config.settings,
    persona: config.persona,
    auth: config.auth,
    use: [],
    disabledServers: [],
  };
}

/** Exit code 3: auth failure / keychain unavailable. */
const EXIT_AUTH = 3;

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
  /** If true, run `resolveSecrets` after cascade. */
  resolveSecrets?: boolean;
  /** If true, print actual secret values (implies `resolveSecrets`). */
  showValues?: boolean;
  /** Injected backend for secret resolution (for tests). */
  backend?: Backend;
}

/**
 * Shared implementation for `profile show` and `render`.
 * Resolves the cascade and either prints human output or JSON.
 *
 * @param opts - Show options.
 * @throws {CliError} If the role cannot be resolved.
 */
export async function runShow(opts: ShowOptions): Promise<void> {
  const {
    role,
    auth,
    json = false,
    provenance = false,
    home,
    cwd,
    pretty = false,
    resolveSecrets: doResolve = false,
    showValues = false,
    backend,
  } = opts;

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

  // Non-resolve path — existing behavior.
  if (!doResolve && !showValues) {
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
    return;
  }

  // Resolve-secrets path.
  // Load the auth profile for secret resolution.
  const authProfilesDoc = loadAuthProfiles(home);
  const authProfileId =
    auth ?? (result.effective as { auth?: { profileId?: string } }).auth?.profileId;
  const authProfile = authProfileId ? authProfilesDoc.authProfiles[authProfileId] : undefined;

  // Resolve backend — fail closed.
  let resolvedBackend: Backend;
  try {
    resolvedBackend = backend ?? (await getBackend());
  } catch (err) {
    throw new CliError(
      `Keychain unavailable: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_AUTH
    );
  }

  if (resolvedBackend.kind === "basic-text" && process.env.MYCLAUDE_ALLOW_PLAINTEXT !== "1") {
    throw new CliError(
      "Linux secret service unavailable (basic-text backend detected).\n" +
        "Refusing to resolve secrets unencrypted.\n" +
        "Fix:\n" +
        "  Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring\n" +
        "  Fedora:         sudo dnf install libsecret\n" +
        "  Arch:           sudo pacman -S libsecret\n\n" +
        "Or set MYCLAUDE_ALLOW_PLAINTEXT=1 if this is a disposable CI container.",
      EXIT_AUTH
    );
  }

  // Show warning banner to stderr when values are exposed.
  if (showValues) {
    process.stderr.write(
      "[WARNING: secrets on screen] --show-values is set. Actual secret values will appear in output.\n"
    );
  }

  const scopeDocForResolution = effectiveConfigToScopeDoc(result.effective);

  let secretResult: Awaited<ReturnType<typeof resolveSecrets>>;
  try {
    secretResult = await resolveSecrets({
      config: scopeDocForResolution,
      authProfile,
      backend: resolvedBackend,
    });
  } catch (err) {
    if (err instanceof BackendUnsafeError) {
      throw new CliError(err.message, EXIT_AUTH);
    }
    throw new CliError(
      `Secret resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_AUTH
    );
  }

  if (json) {
    // Build redacted/resolved JSON based on showValues.
    const { resolvedConfig, resolutionLog, missingRefs } = secretResult;
    writeJson(
      {
        resolved: resolvedConfig,
        resolutionLog,
        missingRefs,
      },
      pretty
    );
    // Footer note always goes to stderr.
    process.stderr.write(
      "(ANTHROPIC_API_KEY is not materialized into env — Claude Code will\n" +
        " receive it via apiKeyHelper.sh at launch time. See docs/06-security.md.)\n"
    );
    return;
  }

  const formatted = renderResolved(scopeDocForResolution, secretResult, {
    showValues,
    role,
    authId: auth,
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
    if (!args.role) {
      throw new CliError("Role argument is required", EXIT_CONFIG_INVALID);
    }
    await runShow({
      role: args.role,
      auth: args.auth,
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

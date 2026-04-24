/**
 * `myclaude launch` orchestration.
 */

import {
  type AuthProfilesDocT,
  type EffectiveConfig,
  type EffectiveSessionConfig,
  type ScopeDocT,
  resolve as coreResolve,
} from "@agent-profile/core";
import {
  cleanupSession,
  createSessionDir,
  sessionsRootDefault,
} from "@agent-profile/persona-deployer";
import type { DeployPersonaOpts } from "@agent-profile/persona-deployer";
import { type Backend, BackendUnsafeError, resolveSecrets } from "@agent-profile/secrets";
import { emitSessionArtifacts, shouldInjectHeadersHelper } from "@agent-profile/session-artifacts";
import { defineCommand } from "citty";
import {
  NO_ROLE_HELP,
  type ResolveActivationInput,
  resolveActivation,
} from "../../activation/resolve.js";
import { loadAuthProfiles } from "../../auth/profiles-file.js";
import {
  CliError,
  EXIT_AUTH_FAILURE,
  EXIT_CONFIG_INVALID,
  EXIT_GENERIC,
  mapCoreError,
} from "../../errors.js";
import { generateCapabilityToken, writeSessionManifest } from "../../session/manifest.js";
import { globalConfigDir, globalFragmentsDir } from "../../utils/paths.js";
import { type ClaudeSpawnFn, spawnClaude } from "./spawn.js";

type AuthProfile = AuthProfilesDocT["authProfiles"][string];

/** Options for the testable launch implementation. */
export interface LaunchOptions {
  role?: string;
  auth?: string;
  keepSession?: boolean;
  home?: string;
  cwd?: string;
  backend?: Backend;
  env?: Record<string, string | undefined>;
  sessionsRoot?: string;
  helperExecutable?: string;
  claudeCommand?: string;
  spawnFn?: ClaudeSpawnFn;
  tokenGenerator?: () => string;
  onMissingSource?: DeployPersonaOpts["onMissingSource"];
}

/**
 * Resolve config, create a runtime session, spawn Claude Code, and clean up.
 *
 * Returns Claude's process exit code. Pre-spawn failures throw `CliError`.
 */
export async function runLaunch(opts: LaunchOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const activationInput: ResolveActivationInput = {
    cwd,
  };
  if (opts.role !== undefined) activationInput.flagRole = opts.role;
  if (opts.auth !== undefined) activationInput.flagAuth = opts.auth;
  if (opts.home !== undefined) activationInput.home = opts.home;
  const activation = resolveActivation(activationInput);

  if (!activation.role) {
    throw new CliError(NO_ROLE_HELP, EXIT_GENERIC);
  }
  if (!activation.auth) {
    throw new CliError(
      "No auth profile selected.",
      EXIT_AUTH_FAILURE,
      "Run `myclaude use <role> --auth <profile>` or pass `myclaude launch --auth <profile>`."
    );
  }

  const { authProfile, authProfiles } = loadActiveAuthProfile(activation.auth, opts.home);
  const cascade = resolveCascade(activation.role, activation.auth, cwd, opts.home);
  const unresolvedScope = effectiveConfigToScopeDoc(cascade.effective);
  const resolvedScope = await resolveLaunchSecrets(unresolvedScope, authProfile, opts.backend, env);
  const resolvedEffective = scopeDocToEffectiveConfig(resolvedScope);
  const artifactEffective = restoreHelperManagedHeaderTemplates(
    cascade.effective,
    resolvedEffective
  );

  const sessionsRoot = opts.sessionsRoot ?? env.MYCLAUDE_SESSIONS_ROOT ?? sessionsRootDefault();
  const session = await createSessionDir({ root: sessionsRoot });
  const capabilityToken = opts.tokenGenerator?.() ?? generateCapabilityToken();
  let exitCode = 0;
  let primaryError: unknown;

  try {
    const emitInput: Parameters<typeof emitSessionArtifacts>[0] = {
      effective: artifactEffective,
      session,
      authMode: authProfile.anthropic.mode,
    };
    if (opts.helperExecutable !== undefined) {
      emitInput.helperExecutable = opts.helperExecutable;
    }
    if (opts.onMissingSource !== undefined) {
      emitInput.onMissingSource = opts.onMissingSource;
    }
    const artifacts = await emitSessionArtifacts(emitInput);

    try {
      await writeSessionManifest({
        sessionDir: session.sessionDir,
        sessionId: session.sessionId,
        authProfiles,
        capabilityToken,
        authProfileId: activation.auth,
        effective: cascade.effective,
      });
    } catch (err) {
      throw new CliError(
        `Failed to write session manifest: ${err instanceof Error ? err.message : String(err)}`,
        EXIT_GENERIC
      );
    }

    const spawnInput: Parameters<typeof spawnClaude>[0] = {
      baseEnv: env,
      effective: { env: resolvedEffective.env },
      runtimePaths: artifacts.runtimePaths,
      sessionId: session.sessionId,
      capabilityToken,
      authMode: authProfile.anthropic.mode,
      sessionsRoot,
    };
    if (opts.claudeCommand !== undefined) {
      spawnInput.command = opts.claudeCommand;
    }
    if (opts.spawnFn !== undefined) {
      spawnInput.spawnFn = opts.spawnFn;
    }
    exitCode = await spawnClaude(spawnInput);
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    if (opts.keepSession) {
      process.stderr.write(`Session kept at ${session.sessionDir}\n`);
    } else {
      await cleanupAfterLaunch(session.sessionDir, sessionsRoot, primaryError, exitCode);
    }
  }

  return exitCode;
}

/** `myclaude launch` command definition. */
export const launchCommand = defineCommand({
  meta: {
    name: "launch",
    description: "Launch Claude Code with the active Agent Profile session",
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
    "keep-session": {
      type: "boolean",
      description: "Keep the ephemeral session directory for debugging",
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
    const launchOptions: LaunchOptions = {};
    if (args["keep-session"] !== undefined) {
      launchOptions.keepSession = args["keep-session"];
    }
    if (args.role !== undefined) launchOptions.role = args.role;
    if (args.auth !== undefined) launchOptions.auth = args.auth;
    if (args.home !== undefined) launchOptions.home = args.home;
    if (args.cwd !== undefined) launchOptions.cwd = args.cwd;
    const exitCode = await runLaunch(launchOptions);
    process.exitCode = exitCode;
  },
});

function loadActiveAuthProfile(
  authProfileId: string,
  home: string | undefined
): { authProfile: AuthProfile; authProfiles: AuthProfilesDocT } {
  const authProfiles = loadAuthProfiles(home);
  const authProfile = authProfiles.authProfiles[authProfileId];
  if (!authProfile) {
    throw new CliError(
      `Auth profile "${authProfileId}" not found.`,
      EXIT_AUTH_FAILURE,
      "Create it with `myclaude auth add` or select a different profile."
    );
  }
  return { authProfile, authProfiles };
}

function resolveCascade(
  role: string,
  authProfileId: string,
  cwd: string,
  home: string | undefined
): EffectiveSessionConfig {
  try {
    return coreResolve({
      role,
      authProfileId,
      cwd,
      globalConfigDir: globalConfigDir(home),
      fragmentDirs: [globalFragmentsDir(home)],
    });
  } catch (err) {
    const mapped = mapCoreError(err);
    throw new CliError(mapped.message, mapped.exitCode, mapped.hint);
  }
}

async function resolveLaunchSecrets(
  config: ScopeDocT,
  authProfile: AuthProfile,
  backend: Backend | undefined,
  env: Record<string, string | undefined>
): Promise<ScopeDocT> {
  try {
    const result = await resolveSecrets({ config, authProfile, backend, env });
    if (result.missingRefs.length > 0) {
      throw new CliError(
        `Secret resolution failed: ${formatMissingRefs(result.missingRefs)}`,
        EXIT_AUTH_FAILURE
      );
    }
    return result.resolvedConfig;
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err instanceof BackendUnsafeError) {
      throw new CliError(err.message, EXIT_AUTH_FAILURE);
    }
    throw new CliError(
      `Secret resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      EXIT_AUTH_FAILURE
    );
  }
}

function formatMissingRefs(
  missingRefs: Awaited<ReturnType<typeof resolveSecrets>>["missingRefs"]
): string {
  return missingRefs
    .map((ref) => `${ref.path} -> ${ref.kind}:${ref.name}`)
    .slice(0, 10)
    .join(", ");
}

function effectiveConfigToScopeDoc(config: EffectiveConfig): ScopeDocT {
  return {
    version: 1,
    mcpServers: config.mcpServers,
    env: config.env,
    settings: config.settings,
    persona: config.persona,
    use: [],
    disabledServers: [],
    ...(config.auth ? { auth: config.auth } : {}),
  };
}

function scopeDocToEffectiveConfig(doc: ScopeDocT): EffectiveConfig {
  return {
    mcpServers: doc.mcpServers as EffectiveConfig["mcpServers"],
    env: doc.env,
    settings: doc.settings,
    persona: {
      claudeMd: doc.persona?.claudeMd ?? [],
      agents: doc.persona?.agents ?? [],
      skills: doc.persona?.skills ?? [],
      slashCmds: doc.persona?.slashCmds ?? [],
      memory: doc.persona?.memory ?? [],
    },
    ...(doc.auth ? { auth: doc.auth } : {}),
  };
}

function restoreHelperManagedHeaderTemplates(
  unresolved: EffectiveConfig,
  resolved: EffectiveConfig
): EffectiveConfig {
  const next = structuredClone(resolved) as EffectiveConfig;

  for (const [serverName, unresolvedServer] of Object.entries(unresolved.mcpServers)) {
    const resolvedServer = next.mcpServers[serverName];
    if (!resolvedServer || !("headers" in unresolvedServer) || !("headers" in resolvedServer)) {
      continue;
    }

    if (shouldInjectHeadersHelper(structuredClone(unresolvedServer) as Record<string, unknown>)) {
      resolvedServer.headers = { ...unresolvedServer.headers };
    }
  }

  return next;
}

async function cleanupAfterLaunch(
  sessionDir: string,
  sessionsRoot: string,
  primaryError: unknown,
  exitCode: number
): Promise<void> {
  try {
    await cleanupSession(sessionDir, { allowedRoots: [sessionsRoot] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (primaryError === undefined && exitCode === 0) {
      throw new CliError(`Failed to clean up session directory: ${message}`, EXIT_GENERIC);
    }
    process.stderr.write(`Failed to clean up session directory: ${message}\n`);
  }
}

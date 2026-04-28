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
import { CliError, EXIT_AUTH_FAILURE, EXIT_GENERIC, mapCoreError } from "../../errors.js";
import { writeJson } from "../../output/json.js";
import { generateCapabilityToken, writeSessionManifest } from "../../session/manifest.js";
import {
  type SessionRecord,
  redactCommandArgs,
  updateSessionRecord,
  writeSessionRecord,
} from "../../session/registry.js";
import { getTransport } from "../../transport/index.js";
import type { CliTransport } from "../../transport/types.js";
import { globalConfigDir, globalFragmentsDir } from "../../utils/paths.js";
import { buildClaudeLaunchArgs } from "./env.js";
import { type ClaudeSpawnFn, spawnClaude } from "./spawn.js";

type AuthProfile = AuthProfilesDocT["authProfiles"][string];

/** Options for the testable launch implementation. */
export interface LaunchOptions {
  role?: string;
  auth?: string;
  bare?: boolean;
  strict?: boolean;
  addDirs?: string[];
  passthroughArgs?: string[];
  retainSession?: boolean;
  keepSession?: boolean;
  dryRun?: boolean;
  json?: boolean;
  pretty?: boolean;
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
  transport?: CliTransport;
  callerPid?: number;
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
  const retainSession = opts.retainSession ?? opts.keepSession ?? false;
  const addDirs = buildLaunchAddDirs(cwd, opts.addDirs);
  const passthroughArgs = opts.passthroughArgs ?? [];
  const strict = opts.strict ?? true;
  const bare = opts.bare ?? false;
  const command = opts.claudeCommand ?? "claude";
  const transportOptions: Parameters<typeof getTransport>[0] = {
    standalone: env.MYCLAUDE_FORCE_STANDALONE === "1",
  };
  if (opts.home !== undefined) {
    transportOptions.home = opts.home;
  }
  const transport = opts.transport ?? (await getTransport(transportOptions));
  const transportOwnedByLaunch = opts.transport === undefined;
  const session = await createSessionDir({ root: sessionsRoot });
  const standaloneCapabilityToken = opts.tokenGenerator?.() ?? generateCapabilityToken();
  let capabilityToken = standaloneCapabilityToken;
  let exitCode = 0;
  let primaryError: unknown;
  let recordWritten = false;
  let daemonSessionStarted = false;
  let daemonSessionEnded = false;
  const startedAtMs = Date.now();

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

    if (!opts.dryRun && transport.transportKind === "daemon") {
      const started = await transport.sessionStart({
        sessionId: session.sessionId,
        pid: opts.callerPid ?? process.pid,
        authProfileId: activation.auth,
      });
      capabilityToken = started.capabilityToken;
      daemonSessionStarted = true;
    }

    const spawnArgs = buildClaudeLaunchArgs(artifacts.runtimePaths, {
      strict,
      bare,
      addDirs,
      passthroughArgs,
    });
    const recordInput: Parameters<typeof createSessionRecord>[0] = {
      sessionId: session.sessionId,
      role: activation.role,
      authProfileId: activation.auth,
      cwd,
      retained: retainSession || Boolean(opts.dryRun),
      runtimePaths: artifacts.runtimePaths,
      command,
      args: spawnArgs,
      status: opts.dryRun ? "dry-run" : "running",
      nowMs: startedAtMs,
    };
    if (opts.dryRun !== undefined) recordInput.dryRun = opts.dryRun;
    const recordBase = createSessionRecord(recordInput);
    await writeSessionRecord({ sessionsRoot, record: recordBase });
    recordWritten = true;

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

    if (opts.dryRun) {
      printDryRun({
        record: recordBase,
        json: opts.json ?? false,
        pretty: opts.pretty ?? false,
      });
      return 0;
    }

    const spawnInput: Parameters<typeof spawnClaude>[0] = {
      baseEnv: env,
      effective: { env: resolvedEffective.env },
      runtimePaths: artifacts.runtimePaths,
      sessionId: session.sessionId,
      capabilityToken,
      authMode: authProfile.anthropic.mode,
      sessionsRoot,
      strict,
      bare,
      addDirs,
      passthroughArgs,
    };
    spawnInput.command = command;
    if (opts.spawnFn !== undefined) {
      spawnInput.spawnFn = opts.spawnFn;
    }
    exitCode = await spawnClaude(spawnInput);
    const endedAtMs = Date.now();
    await updateSessionRecord({
      sessionsRoot,
      sessionId: session.sessionId,
      patch: {
        status: "exited",
        exitCode,
        wallMs: endedAtMs - startedAtMs,
        endedAt: new Date(endedAtMs).toISOString(),
        updatedAt: new Date(endedAtMs).toISOString(),
      },
    });
  } catch (err) {
    primaryError = err;
    if (recordWritten) {
      const failedAtMs = Date.now();
      await updateSessionRecord({
        sessionsRoot,
        sessionId: session.sessionId,
        patch: {
          status: "failed",
          wallMs: failedAtMs - startedAtMs,
          endedAt: new Date(failedAtMs).toISOString(),
          updatedAt: new Date(failedAtMs).toISOString(),
        },
      }).catch(() => {
        // Preserve the original launch error.
      });
    }
    throw err;
  } finally {
    try {
      if (daemonSessionStarted && !daemonSessionEnded) {
        daemonSessionEnded = true;
        await endDaemonSession({
          transport,
          sessionId: session.sessionId,
          primaryError,
          exitCode,
        });
      }
    } finally {
      try {
        if (opts.dryRun && primaryError === undefined) {
          process.stderr.write(`Dry-run session kept at ${session.sessionDir}\n`);
        } else if (retainSession) {
          process.stderr.write(`Session kept at ${session.sessionDir}\n`);
        } else {
          await cleanupAfterLaunch(session.sessionDir, sessionsRoot, primaryError, exitCode);
          if (recordWritten) {
            await updateSessionRecord({
              sessionsRoot,
              sessionId: session.sessionId,
              patch: {
                cleaned: true,
                updatedAt: new Date().toISOString(),
              },
            }).catch(() => {
              // Cleanup already happened; do not mask the launch result.
            });
          }
        }
      } finally {
        if (transportOwnedByLaunch) {
          await transport.close();
        }
      }
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
    bare: {
      type: "boolean",
      description: "Pass --bare to Claude Code",
      default: false,
    },
    strict: {
      type: "boolean",
      description: "Pass --strict-mcp-config to Claude Code",
      default: true,
    },
    "add-dir": {
      type: "string",
      description: "Add a working directory for Claude Code (repeatable)",
    },
    "retain-session": {
      type: "boolean",
      description: "Keep the ephemeral session directory after exit",
      default: false,
    },
    "keep-session": {
      type: "boolean",
      description: "Deprecated alias for --retain-session",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Resolve and emit session artifacts without spawning Claude Code",
      default: false,
    },
    json: {
      type: "boolean",
      description: "With --dry-run, emit structured JSON to stdout",
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
  async run({ args, rawArgs }) {
    const launchOptions: LaunchOptions = {};
    launchOptions.bare = Boolean(args.bare);
    launchOptions.strict = args.strict !== false;
    launchOptions.addDirs = normalizeRepeatedStringArg(args["add-dir"]);
    launchOptions.passthroughArgs = extractPassthroughArgs(rawArgs);
    launchOptions.retainSession = Boolean(args["retain-session"]);
    launchOptions.keepSession = Boolean(args["keep-session"]);
    launchOptions.dryRun = Boolean(args["dry-run"]);
    launchOptions.json = Boolean(args.json);
    launchOptions.pretty = Boolean(args.pretty);
    if (args.role !== undefined) launchOptions.role = args.role;
    if (args.auth !== undefined) launchOptions.auth = args.auth;
    if (args.home !== undefined) launchOptions.home = args.home;
    if (args.cwd !== undefined) launchOptions.cwd = args.cwd;
    const exitCode = await runLaunch(launchOptions);
    process.exitCode = exitCode;
  },
});

function createSessionRecord(input: {
  sessionId: string;
  role: string;
  authProfileId: string;
  cwd: string;
  retained: boolean;
  runtimePaths: SessionRecord["runtimePaths"];
  command: string;
  args: string[];
  status: SessionRecord["status"];
  dryRun?: boolean;
  nowMs: number;
}): SessionRecord {
  const now = new Date(input.nowMs).toISOString();
  const record: SessionRecord = {
    version: 1,
    sessionId: input.sessionId,
    role: input.role,
    authProfileId: input.authProfileId,
    cwd: input.cwd,
    createdAt: now,
    updatedAt: now,
    retained: input.retained,
    cleaned: false,
    runtimePaths: input.runtimePaths,
    spawn: {
      command: input.command,
      args: redactCommandArgs(input.args),
    },
    status: input.status,
  };
  if (input.dryRun !== undefined) record.dryRun = input.dryRun;
  if (input.status === "running") record.startedAt = now;
  if (input.status === "dry-run") record.endedAt = now;
  return record;
}

function buildLaunchAddDirs(cwd: string, addDirs: string[] | undefined): string[] {
  return [cwd, ...(addDirs ?? [])];
}

function printDryRun(input: { record: SessionRecord; json: boolean; pretty: boolean }): void {
  const { record } = input;
  if (input.json || input.pretty) {
    writeJson({ launch: record }, input.pretty);
    return;
  }

  const lines = [
    `Session: ${record.sessionId}`,
    `Role:    ${record.role}`,
    `Auth:    ${record.authProfileId}`,
    `Dir:     ${record.runtimePaths.sessionDir}`,
    `Status:  ${record.status}`,
    `Command: ${record.spawn.command} ${record.spawn.args.join(" ")}`.trimEnd(),
    "Files:",
    `  mcp.json          ${record.runtimePaths.mcpConfig}`,
    `  settings.json     ${record.runtimePaths.settings}`,
  ];

  if (record.runtimePaths.apiKeyHelper) {
    lines.push(`  apiKeyHelper.sh  ${record.runtimePaths.apiKeyHelper}`);
  }
  if (record.runtimePaths.headersHelper) {
    lines.push(`  headersHelper.sh  ${record.runtimePaths.headersHelper}`);
  }
  if (record.runtimePaths.claudeMd) {
    lines.push(`  CLAUDE.md         ${record.runtimePaths.claudeMd}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function normalizeRepeatedStringArg(value: unknown): string[] {
  if (value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [String(value)];
}

export function extractPassthroughArgs(rawArgs: string[] | undefined): string[] {
  const separatorIndex = rawArgs?.indexOf("--") ?? -1;
  return separatorIndex >= 0 ? (rawArgs ?? []).slice(separatorIndex + 1) : [];
}

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

async function endDaemonSession(input: {
  transport: CliTransport;
  sessionId: string;
  primaryError: unknown;
  exitCode: number;
}): Promise<void> {
  try {
    await input.transport.sessionEnd({ sessionId: input.sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (input.primaryError === undefined && input.exitCode === 0) {
      throw new CliError(`Failed to end daemon session: ${message}`, EXIT_GENERIC);
    }
    process.stderr.write(`Failed to end daemon session: ${message}\n`);
  }
}

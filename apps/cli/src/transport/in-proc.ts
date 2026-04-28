/**
 * @module transport/in-proc
 *
 * Standalone (no-daemon) transport.
 *
 * Wraps the pure data services from `@agent-profile/cli-services` so the
 * CLI's read-only commands continue to work exactly as they did in Phase 1
 * when the daemon is absent. `close()` is a no-op; `daemonStop()` rejects.
 */

import {
  type AuthListEntry,
  type SessionRecord,
  authGetSecretRefService,
  authListService,
  daemonStatusService,
  profileShowService,
  sessionsListService,
} from "@agent-profile/cli-services";
import { CliError, EXIT_DAEMON_UNREACHABLE } from "../errors.js";
import type {
  CliTransport,
  TransportAuthAddInput,
  TransportAuthGetSecretRefInput,
  TransportAuthGetSecretRefResult,
  TransportAuthListInput,
  TransportAuthListResult,
  TransportAuthProfile,
  TransportAuthRemoveInput,
  TransportAuthRemoveResult,
  TransportAuthRotateInput,
  TransportAuthSetSecretInput,
  TransportDaemonStatusResult,
  TransportDaemonStopInput,
  TransportProfileShowInput,
  TransportProfileShowResult,
  TransportSecretsMigrateInput,
  TransportSecretsMigrateResult,
  TransportSessionsListInput,
} from "./types.js";

/**
 * In-process transport — calls `cli-services` directly. Used both as the
 * Phase 1 default and as a fall-through when the daemon is not running.
 */
export class InProcTransport implements CliTransport {
  readonly transportKind = "standalone" as const;

  async authList(input: TransportAuthListInput): Promise<TransportAuthListResult> {
    const serviceInput: Parameters<typeof authListService>[0] = {
      includeRefs: input.includeRefs ?? false,
    };
    if (input.home !== undefined) serviceInput.home = input.home;
    const { profiles } = authListService(serviceInput);
    return { profiles: profiles.map((entry) => projectAuthEntry(entry)) };
  }

  async authGetSecretRef(
    input: TransportAuthGetSecretRefInput
  ): Promise<TransportAuthGetSecretRefResult> {
    const serviceInput: Parameters<typeof authGetSecretRefService>[0] = {
      authId: input.authId,
      name: input.name,
    };
    if (input.home !== undefined) serviceInput.home = input.home;
    return authGetSecretRefService(serviceInput);
  }

  async profileShow(input: TransportProfileShowInput): Promise<TransportProfileShowResult> {
    const serviceInput: Parameters<typeof profileShowService>[0] = {
      role: input.role,
      cwd: input.cwd,
      home: input.home,
    };
    if (input.authProfileId !== undefined) serviceInput.authProfileId = input.authProfileId;
    const result = profileShowService(serviceInput);
    return {
      effective: result.effective,
      provenance: result.provenance,
      // EffectiveSessionConfig has no `runtimePaths`; surface null for parity with daemon.
      runtimePaths: null,
    };
  }

  async sessionsList(input: TransportSessionsListInput): Promise<SessionRecord[]> {
    const serviceInput: Parameters<typeof sessionsListService>[0] = {
      sessionsRoot: input.sessionsRoot,
    };
    if (input.activeOnly !== undefined) serviceInput.activeOnly = input.activeOnly;
    return sessionsListService(serviceInput);
  }

  async daemonStatus(): Promise<TransportDaemonStatusResult> {
    // Synthesize a "no-daemon" status from the local registry. We use
    // pid=0 + empty socketPath as the in-proc sentinel; the CLI's
    // `daemon status` command rejects this case before formatting.
    // We still try to read the local sessions root to give an honest
    // session-count snapshot when the user explicitly wants the offline
    // view (rare, but supported).
    const sessionsRoot = process.env.MYCLAUDE_SESSIONS_ROOT ?? "";
    if (sessionsRoot.length === 0) {
      return {
        pid: 0,
        socketPath: "",
        uptimeMs: 0,
        sessionCounts: { active: 0, total: 0 },
      };
    }
    const status = await daemonStatusService({
      pid: 0,
      socketPath: "",
      startedAtMs: Date.now(),
      sessionsRoot,
    });
    return status;
  }

  async daemonStop(_input: TransportDaemonStopInput): Promise<void> {
    throw new CliError(
      "Daemon not running; nothing to stop.",
      EXIT_DAEMON_UNREACHABLE,
      "Start it with `myclaude daemon start` if you intended to run it."
    );
  }

  // The standalone path keeps existing CLI commands writing keychain entries
  // directly via `@agent-profile/secrets` (Phase 1 behavior). The transport
  // exposes these methods so callers that *also* run with a daemon can route
  // through the same surface; in-proc rejects them so the command layer falls
  // back to its existing direct path.
  async authAdd(_input: TransportAuthAddInput): Promise<void> {
    throw daemonRequired("auth.add");
  }
  async authSetSecret(_input: TransportAuthSetSecretInput): Promise<void> {
    throw daemonRequired("auth.setSecret");
  }
  async authRotate(_input: TransportAuthRotateInput): Promise<void> {
    throw daemonRequired("auth.rotate");
  }
  async authRemove(_input: TransportAuthRemoveInput): Promise<TransportAuthRemoveResult> {
    throw daemonRequired("auth.remove");
  }
  async secretsMigrate(
    _input: TransportSecretsMigrateInput
  ): Promise<TransportSecretsMigrateResult> {
    throw new CliError(
      "secrets migrate requires a running daemon.",
      EXIT_DAEMON_UNREACHABLE,
      "Start the daemon with `myclaude daemon start` and try again."
    );
  }

  async close(): Promise<void> {
    // No connection to release.
  }
}

/**
 * Standalone-path stub for the four write methods. These calls only make
 * sense when routed through the daemon (which owns `safeStorage`); the
 * standalone CLI's existing `auth.add` / `auth.set` / `auth.rotate` /
 * `auth.remove` commands write to the keychain directly without going
 * through the transport, so this stub is only ever hit by callers that
 * deliberately routed through `getTransport`.
 */
function daemonRequired(operation: string): CliError {
  return new CliError(
    `${operation} via transport requires a running daemon.`,
    EXIT_DAEMON_UNREACHABLE,
    "Start it with `myclaude daemon start` or use the equivalent direct command."
  );
}

/** Project a service-layer entry into the transport's wire shape. */
function projectAuthEntry(entry: AuthListEntry): TransportAuthProfile {
  const projected: TransportAuthProfile = {
    id: entry.id,
    displayName: entry.displayName,
    mode: entry.mode,
    secrets: entry.secrets,
  };
  if (entry.refs !== undefined) projected.refs = entry.refs;
  if (entry.anthropicRef !== undefined) projected.anthropicRef = entry.anthropicRef;
  return projected;
}

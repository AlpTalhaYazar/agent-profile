/**
 * @module transport/daemon
 *
 * Daemon-routed transport.
 *
 * Wraps a connected `DaemonClient` from `@agent-profile/ipc-protocol` and
 * implements the `CliTransport` interface by forwarding each call as an IPC
 * request. Translates `IpcError` into `CliError` with appropriate exit codes
 * so command-level error handling is uniform across the two transports.
 */

import type { SessionRecord } from "@agent-profile/cli-services";
import type {
  DaemonClient,
  EvtSessionsEventT,
  ReqT,
  RespAuthGetSecretRefOkT,
  RespAuthListOkT,
  RespDaemonStatusOkT,
  RespDaemonStopOkT,
  RespPersonaRenderOkT,
  RespProfileShowOkT,
  RespSessionEndOkT,
  RespSessionStartOkT,
  RespSessionsDriftOkT,
  RespSessionsKillOkT,
  RespSessionsListOkT,
  RespSessionsRelaunchOkT,
  RespT,
} from "@agent-profile/ipc-protocol";
import { IpcError } from "@agent-profile/ipc-protocol";
import { CliError, EXIT_AUTH_FAILURE, EXIT_DAEMON_UNREACHABLE, EXIT_GENERIC } from "../errors.js";
import type {
  CliTransport,
  SessionsSubscribeHandle,
  TransportAuthAddInput,
  TransportAuthGetSecretRefInput,
  TransportAuthGetSecretRefResult,
  TransportAuthListInput,
  TransportAuthListResult,
  TransportAuthRemoveInput,
  TransportAuthRemoveResult,
  TransportAuthRotateInput,
  TransportAuthSetSecretInput,
  TransportDaemonStatusResult,
  TransportDaemonStopInput,
  TransportPersonaRenderInput,
  TransportPersonaRenderResult,
  TransportProfileShowInput,
  TransportProfileShowResult,
  TransportSecretsMigrateInput,
  TransportSecretsMigrateResult,
  TransportSessionEndInput,
  TransportSessionStartInput,
  TransportSessionStartResult,
  TransportSessionsDriftInput,
  TransportSessionsDriftResult,
  TransportSessionsKillInput,
  TransportSessionsKillResult,
  TransportSessionsListInput,
  TransportSessionsRelaunchInput,
  TransportSessionsRelaunchResult,
  TransportSessionsSubscribeInput,
} from "./types.js";

/**
 * Daemon transport — every call goes over the IPC socket.
 *
 * Construct via `getTransport`; do NOT instantiate directly. Always call
 * `close()` after the last request.
 */
export class DaemonTransport implements CliTransport {
  readonly transportKind = "daemon" as const;
  private readonly client: DaemonClient;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  async authList(input: TransportAuthListInput): Promise<TransportAuthListResult> {
    const body: Record<string, unknown> = {};
    if (input.includeRefs !== undefined) body.includeRefs = input.includeRefs;
    const resp = await this.requestSafe<RespAuthListOkT>("auth.list", body);
    return {
      profiles: resp.profiles.map((p) => ({
        id: p.id,
        // The wire schema's `displayName` is `z.string()`; null is returned by
        // the in-proc path. We pass the value through; when it's an empty
        // string the daemon already chose to flatten null → "".
        displayName: p.displayName,
        mode: p.mode,
        secrets: p.secrets,
      })),
    };
  }

  async authGetSecretRef(
    input: TransportAuthGetSecretRefInput
  ): Promise<TransportAuthGetSecretRefResult> {
    const resp = await this.requestSafe<RespAuthGetSecretRefOkT>("auth.get-secret-ref", {
      authId: input.authId,
      name: input.name,
    });
    return { ref: resp.ref };
  }

  async profileShow(input: TransportProfileShowInput): Promise<TransportProfileShowResult> {
    const body: Record<string, unknown> = {
      role: input.role,
      cwd: input.cwd,
    };
    // The wire schema requires authProfileId. Daemon callers without one are
    // rare (no `myclaude use`), but we still support the unset case by
    // omitting the field — the daemon will reject it with BAD_REQUEST and
    // that surfaces as a CliError(EXIT_GENERIC) below. The CLI command layer
    // is responsible for ensuring `auth` is present before calling.
    if (input.authProfileId !== undefined) body.authProfileId = input.authProfileId;
    const resp = await this.requestSafe<RespProfileShowOkT>("profile.show", body);
    return {
      effective: resp.effective,
      provenance: resp.provenance,
      runtimePaths: null,
    };
  }

  async sessionsList(input: TransportSessionsListInput): Promise<SessionRecord[]> {
    const body: Record<string, unknown> = {};
    if (input.activeOnly !== undefined) body.activeOnly = input.activeOnly;
    const resp = await this.requestSafe<RespSessionsListOkT>("sessions.list", body);
    // The wire schema is `z.array(z.unknown())`. Trust the daemon — re-validation
    // against the SessionRecord shape happens in caller-specific formatters.
    return resp.sessions as SessionRecord[];
  }

  async daemonStatus(): Promise<TransportDaemonStatusResult> {
    const resp = await this.requestSafe<RespDaemonStatusOkT>("daemon.status", {});
    return {
      pid: resp.pid,
      socketPath: resp.socketPath,
      uptimeMs: resp.uptimeMs,
      sessionCounts: resp.sessionCounts,
    };
  }

  async daemonStop(input: TransportDaemonStopInput): Promise<void> {
    const body: Record<string, unknown> = {};
    if (input.force !== undefined) body.force = input.force;
    await this.requestSafe<RespDaemonStopOkT>("daemon.stop", body);
  }

  async authAdd(input: TransportAuthAddInput): Promise<void> {
    const body: Record<string, unknown> = {
      spec: input.spec,
      anthropicSecretB64: Buffer.from(input.anthropicSecret, "utf8").toString("base64"),
    };
    if (input.force !== undefined) body.force = input.force;
    await this.requestSafe("auth.add", body);
  }

  async authSetSecret(input: TransportAuthSetSecretInput): Promise<void> {
    const body: Record<string, unknown> = {
      authId: input.authId,
      name: input.name,
      valueB64: Buffer.from(input.value, "utf8").toString("base64"),
    };
    if (input.register !== undefined) body.register = input.register;
    await this.requestSafe("auth.setSecret", body);
  }

  async authRotate(input: TransportAuthRotateInput): Promise<void> {
    await this.requestSafe("auth.rotate", {
      authId: input.authId,
      anthropicSecretB64: Buffer.from(input.anthropicSecret, "utf8").toString("base64"),
    });
  }

  async authRemove(input: TransportAuthRemoveInput): Promise<TransportAuthRemoveResult> {
    const body: Record<string, unknown> = { authId: input.authId };
    if (input.yes !== undefined) body.yes = input.yes;
    const resp = await this.requestSafe<{ kind: "auth.remove.ok"; failed: string[] } & RespT>(
      "auth.remove",
      body
    );
    return { failed: resp.failed };
  }

  async secretsMigrate(
    input: TransportSecretsMigrateInput
  ): Promise<TransportSecretsMigrateResult> {
    const body: Record<string, unknown> = {};
    if (input.dryRun !== undefined) body.dryRun = input.dryRun;
    if (input.keepKeyring !== undefined) body.keepKeyring = input.keepKeyring;
    const resp = await this.requestSafe<
      {
        kind: "secrets.migrate.ok";
        scanned: number;
        migrated: number;
        skipped: number;
        errors: { key: string; reason: string }[];
      } & RespT
    >("secrets.migrate", body);
    return {
      scanned: resp.scanned,
      migrated: resp.migrated,
      skipped: resp.skipped,
      errors: resp.errors,
    };
  }

  async sessionStart(input: TransportSessionStartInput): Promise<TransportSessionStartResult> {
    const legacyBody: Record<string, unknown> = {
      sessionId: input.sessionId,
      pid: input.pid,
    };
    if (input.ttlMs !== undefined) legacyBody.ttlMs = input.ttlMs;

    const preferredBody: Record<string, unknown> = { ...legacyBody };
    if (input.authProfileId !== undefined) {
      preferredBody.authProfileId = input.authProfileId;
    }

    try {
      const resp = await this.client.request<RespSessionStartOkT>("session.start", preferredBody);
      return {
        capabilityToken: resp.capabilityToken,
        expiresAtMs: resp.expiresAtMs,
      };
    } catch (err) {
      if (
        input.authProfileId !== undefined &&
        err instanceof IpcError &&
        err.code === "BAD_REQUEST"
      ) {
        const resp = await this.requestSafe<RespSessionStartOkT>("session.start", legacyBody);
        return {
          capabilityToken: resp.capabilityToken,
          expiresAtMs: resp.expiresAtMs,
        };
      }
      throw mapIpcError(err);
    }
  }

  async sessionEnd(input: TransportSessionEndInput): Promise<void> {
    await this.requestSafe<RespSessionEndOkT>("session.end", {
      sessionId: input.sessionId,
    });
  }

  async sessionsKill(input: TransportSessionsKillInput): Promise<TransportSessionsKillResult> {
    const body: Record<string, unknown> = { sessionId: input.sessionId };
    if (input.signal !== undefined) body.signal = input.signal;
    const resp = await this.requestSafe<RespSessionsKillOkT>("sessions.kill", body);
    const result: TransportSessionsKillResult = { killed: resp.killed };
    if (resp.exitCode !== undefined) result.exitCode = resp.exitCode;
    return result;
  }

  async sessionsRelaunch(
    input: TransportSessionsRelaunchInput
  ): Promise<TransportSessionsRelaunchResult> {
    const resp = await this.requestSafe<RespSessionsRelaunchOkT>("sessions.relaunch", {
      sessionId: input.sessionId,
    });
    return {
      sessionId: resp.sessionId,
      capabilityToken: resp.capabilityToken,
      expiresAtMs: resp.expiresAtMs,
      relaunchedFrom: resp.relaunchedFrom,
    };
  }

  async sessionsDrift(input: TransportSessionsDriftInput): Promise<TransportSessionsDriftResult> {
    const resp = await this.requestSafe<RespSessionsDriftOkT>("sessions.drift", {
      sessionId: input.sessionId,
    });
    return {
      drifted: resp.drifted,
      scopesChanged: resp.scopesChanged,
      oldHash: resp.oldHash,
      newHash: resp.newHash,
    };
  }

  async personaRender(input: TransportPersonaRenderInput): Promise<TransportPersonaRenderResult> {
    // The wire schema does not carry `home` — the daemon derives it from its
    // own `myClaudeHome`. We deliberately drop the field on the way in and
    // reconstruct the cli-services `PersonaRenderResult` shape on the way out
    // (see notes on each block below).
    const resp = await this.requestSafe<RespPersonaRenderOkT>("persona.render", {
      role: input.role,
      authProfileId: input.authProfileId,
      cwd: input.cwd,
    });
    return {
      claudeMd: resp.claudeMd
        ? {
            combinedContent: resp.claudeMd.combinedContent,
            sections: resp.claudeMd.sections.map((sec) => ({
              sourcePath: sec.sourcePath,
              originScope: sec.originScope,
              content: sec.content,
            })),
          }
        : null,
      files: resp.files.map((file) => ({
        category: file.category,
        basename: file.basename,
        sourcePath: file.sourcePath,
        originScope: file.originScope,
        content: file.content,
      })),
      // Wire emits one entry per `(category, basename)` group; the daemon
      // handler emits step-by-step (one wire entry per `overriddenSources`
      // element). We flatten the wire's `overriddenSources` array back into
      // per-step `CollisionLogEntry` objects so the result shape matches the
      // in-proc transport exactly.
      collisions: resp.collisions.flatMap((collision) =>
        collision.overriddenSources.map((overriddenSource) => ({
          target: collision.basename,
          category: collision.category,
          overriddenSource,
          winningSource: collision.winningSource,
        }))
      ),
      // Wire drops `targetPath`; reconstruct as empty string so consumers see
      // a stable shape. The CLI command's text + JSON output never reads this
      // field and the GUI Persona Composer surfaces `sourcePath` only.
      missingSources: resp.missingSources.map((entry) => ({
        category: entry.category,
        sourcePath: entry.sourcePath,
        targetPath: "",
      })),
    };
  }

  async sessionsSubscribe(
    input: TransportSessionsSubscribeInput
  ): Promise<SessionsSubscribeHandle> {
    try {
      await this.client.subscribe("sessions");
    } catch (err) {
      throw mapIpcError(err);
    }
    const listener = (event: EvtSessionsEventT): void => {
      input.onEvent(event);
    };
    this.client.on("sessions.event", listener);
    let detached = false;
    return {
      unsubscribe: () => {
        if (detached) return;
        detached = true;
        this.client.off("sessions.event", listener);
      },
    };
  }

  async close(): Promise<void> {
    this.client.close();
  }

  /**
   * Run `client.request` and translate `IpcError` to `CliError`. Any other
   * thrown value is re-thrown as-is — caller-level error handlers know how to
   * map them.
   */
  private async requestSafe<R extends RespT>(
    kind: ReqT["kind"],
    body: Record<string, unknown>
  ): Promise<R> {
    try {
      return await this.client.request<R>(kind, body);
    } catch (err) {
      throw mapIpcError(err);
    }
  }
}

/** Translate an `IpcError` to a `CliError` with the matching exit code. */
function mapIpcError(err: unknown): unknown {
  if (!(err instanceof IpcError)) return err;
  switch (err.code) {
    case "DISCONNECTED":
    case "TIMEOUT":
      return new CliError(
        `Daemon unreachable: ${err.message}`,
        EXIT_DAEMON_UNREACHABLE,
        "Run `myclaude daemon status` to check, or restart it with `myclaude daemon start`."
      );
    case "AUTH":
    case "AUTH_VERSION":
    case "BAD_COOKIE":
      return new CliError(
        `Daemon rejected the connection: ${err.message}`,
        EXIT_AUTH_FAILURE,
        "Restart the daemon to refresh the boot cookie."
      );
    case "NOT_FOUND":
    case "BAD_REQUEST":
      return new CliError(`Daemon error: ${err.message}`, EXIT_GENERIC);
    default:
      return new CliError(`Daemon error: ${err.message}`, EXIT_GENERIC);
  }
}

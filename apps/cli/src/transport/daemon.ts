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
  ReqT,
  RespAuthGetSecretRefOkT,
  RespAuthListOkT,
  RespDaemonStatusOkT,
  RespDaemonStopOkT,
  RespProfileShowOkT,
  RespSessionsListOkT,
  RespT,
} from "@agent-profile/ipc-protocol";
import { IpcError } from "@agent-profile/ipc-protocol";
import { CliError, EXIT_AUTH_FAILURE, EXIT_DAEMON_UNREACHABLE, EXIT_GENERIC } from "../errors.js";
import type {
  CliTransport,
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
  TransportProfileShowInput,
  TransportProfileShowResult,
  TransportSecretsMigrateInput,
  TransportSecretsMigrateResult,
  TransportSessionsListInput,
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

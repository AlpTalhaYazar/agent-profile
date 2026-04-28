/**
 * @module transport/types
 *
 * Shared interface for the CLI's data-access transport.
 *
 * The CLI has two transports:
 *
 *  - `InProcTransport` — calls `@agent-profile/cli-services` directly (Phase 1
 *    standalone behavior; what every read-only command did before).
 *  - `DaemonTransport` — wraps a `DaemonClient` and goes through the running
 *    Electron Main daemon over a Unix Domain Socket (POSIX) or Named Pipe
 *    (Windows).
 *
 * Both transports return identical data shapes so the formatting code stays
 * the same regardless of where the data came from. The selector is
 * `transport.transportKind`, which command code can branch on for the few
 * places where the daemon's wire shape (`auth.list`) genuinely differs from
 * the YAML shape (`AuthProfilesDocT`).
 */

import type { SessionRecord } from "@agent-profile/cli-services";

/**
 * Input options for `transport.authList`.
 */
export interface TransportAuthListInput {
  /** Override myclaude home directory. */
  home?: string;
  /** When true, the response includes keyring URIs. */
  includeRefs?: boolean;
}

/** A single projected auth-profile entry as returned over either transport. */
export interface TransportAuthProfile {
  id: string;
  /** May be `null` (unset) over in-proc; daemon flattens null to "" — both are accepted by callers. */
  displayName: string | null;
  mode: string;
  secrets: string[];
  /** Present only when `includeRefs` is true. */
  refs?: Record<string, string>;
  /** Present only when `includeRefs` is true. */
  anthropicRef?: string;
}

/** Result of `transport.authList`. */
export interface TransportAuthListResult {
  profiles: TransportAuthProfile[];
}

/** Input for `transport.authGetSecretRef`. */
export interface TransportAuthGetSecretRefInput {
  home?: string;
  authId: string;
  name: string;
}

/** Result of `transport.authGetSecretRef`. */
export interface TransportAuthGetSecretRefResult {
  ref: string | null;
}

/** Input for `transport.profileShow`. */
export interface TransportProfileShowInput {
  role: string;
  authProfileId?: string;
  cwd: string;
  home: string;
}

/**
 * Result of `transport.profileShow`. The `effective` and `provenance` shapes
 * mirror `EffectiveSessionConfig` from `@agent-profile/core`. We type these as
 * `unknown` here because the wire schema does too — callers that want to act
 * on individual fields should re-cast at the call site.
 */
export interface TransportProfileShowResult {
  effective: unknown;
  provenance: unknown;
  /** Always `null` when going through the daemon; the in-proc path forwards core's value. */
  runtimePaths?: unknown;
}

/** Input for `transport.sessionsList`. */
export interface TransportSessionsListInput {
  sessionsRoot: string;
  activeOnly?: boolean;
}

/** Input for `transport.daemonStop`. */
export interface TransportDaemonStopInput {
  force?: boolean;
}

// ─── Write-side I/O (Phase 2 milestone 3) ────────────────────────────────────

/** Auth profile spec used by `transport.authAdd`. */
export interface TransportAuthAddSpec {
  id: string;
  displayName?: string;
  anthropic: {
    mode: "apiKey" | "bedrock" | "vertex" | "gateway";
    secretRef: string;
  };
  mcpSecretRefs?: Record<string, string>;
}

/** Input for `transport.authAdd`. */
export interface TransportAuthAddInput {
  spec: TransportAuthAddSpec;
  /** Plaintext Anthropic secret. The transport encodes to base64 before sending. */
  anthropicSecret: string;
  force?: boolean;
}

/** Input for `transport.authSetSecret`. */
export interface TransportAuthSetSecretInput {
  authId: string;
  name: string;
  value: string;
  register?: boolean;
}

/** Input for `transport.authRotate`. */
export interface TransportAuthRotateInput {
  authId: string;
  anthropicSecret: string;
}

/** Input for `transport.authRemove`. */
export interface TransportAuthRemoveInput {
  authId: string;
  yes?: boolean;
}

/** Result of `transport.authRemove`. */
export interface TransportAuthRemoveResult {
  /** Secret names whose keychain delete failed (empty on full success). */
  failed: string[];
}

/** Input for `transport.secretsMigrate`. */
export interface TransportSecretsMigrateInput {
  dryRun?: boolean;
  keepKeyring?: boolean;
}

/** Result of `transport.secretsMigrate`. */
export interface TransportSecretsMigrateResult {
  scanned: number;
  migrated: number;
  skipped: number;
  errors: { key: string; reason: string }[];
}

/** Input for `transport.sessionStart`. */
export interface TransportSessionStartInput {
  sessionId: string;
  pid: number;
  ttlMs?: number;
  /**
   * Reserved for newer daemons that bind capabilities to a specific auth profile.
   * Older daemons may reject it; the daemon transport handles that compatibility.
   */
  authProfileId?: string;
}

/** Result of `transport.sessionStart`. */
export interface TransportSessionStartResult {
  capabilityToken: string;
  expiresAtMs: number;
}

/** Input for `transport.sessionEnd`. */
export interface TransportSessionEndInput {
  sessionId: string;
}

/** Result of `transport.daemonStatus`. Identical shape to `RespDaemonStatusOk` body. */
export interface TransportDaemonStatusResult {
  pid: number;
  socketPath: string;
  uptimeMs: number;
  sessionCounts: {
    active: number;
    total: number;
  };
}

/**
 * The transport contract every CLI data-access call goes through.
 *
 * Implementations are constructed by `getTransport` in the same module's
 * `index.ts`. Commands MUST call `close()` when done — the in-proc impl makes
 * it a no-op, but the daemon impl needs to release the socket.
 */
export interface CliTransport {
  /** Discriminator so commands can branch on transport when shapes diverge. */
  readonly transportKind: "daemon" | "standalone";

  authList(input: TransportAuthListInput): Promise<TransportAuthListResult>;

  authGetSecretRef(input: TransportAuthGetSecretRefInput): Promise<TransportAuthGetSecretRefResult>;

  profileShow(input: TransportProfileShowInput): Promise<TransportProfileShowResult>;

  sessionsList(input: TransportSessionsListInput): Promise<SessionRecord[]>;

  daemonStatus(): Promise<TransportDaemonStatusResult>;

  daemonStop(input: TransportDaemonStopInput): Promise<void>;

  authAdd(input: TransportAuthAddInput): Promise<void>;

  authSetSecret(input: TransportAuthSetSecretInput): Promise<void>;

  authRotate(input: TransportAuthRotateInput): Promise<void>;

  authRemove(input: TransportAuthRemoveInput): Promise<TransportAuthRemoveResult>;

  secretsMigrate(input: TransportSecretsMigrateInput): Promise<TransportSecretsMigrateResult>;

  sessionStart(input: TransportSessionStartInput): Promise<TransportSessionStartResult>;

  sessionEnd(input: TransportSessionEndInput): Promise<void>;

  /** Release any underlying connection. Idempotent and safe to call on either transport. */
  close(): Promise<void>;
}

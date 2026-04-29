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

import type { PersonaRenderResult, SessionRecord } from "@agent-profile/cli-services";
import type { EvtSessionsEventT } from "@agent-profile/ipc-protocol";

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

// ─── Session monitor I/O (Phase 2 milestone 5) ───────────────────────────────

/** Input for `transport.sessionsKill`. */
export interface TransportSessionsKillInput {
  sessionId: string;
  signal?: "SIGTERM" | "SIGKILL";
}

/** Result of `transport.sessionsKill`. */
export interface TransportSessionsKillResult {
  killed: boolean;
  exitCode?: number;
}

/** Input for `transport.sessionsRelaunch`. */
export interface TransportSessionsRelaunchInput {
  sessionId: string;
}

/** Result of `transport.sessionsRelaunch`. */
export interface TransportSessionsRelaunchResult {
  sessionId: string;
  capabilityToken: string;
  expiresAtMs: number;
  relaunchedFrom: string;
}

/** Input for `transport.sessionsDrift`. */
export interface TransportSessionsDriftInput {
  sessionsRoot: string;
  sessionId: string;
  home: string;
}

/** Result of `transport.sessionsDrift`. */
export interface TransportSessionsDriftResult {
  drifted: boolean;
  scopesChanged: string[];
  oldHash: string;
  newHash: string;
}

/**
 * Input for `transport.sessionsSubscribe`.
 *
 * The `onEvent` callback fires every time the daemon pushes a `sessions.event`
 * frame. The promise resolves once the subscription has been acknowledged.
 */
export interface TransportSessionsSubscribeInput {
  onEvent: (event: EvtSessionsEventT) => void;
}

// ─── Persona render I/O (Phase 2 milestone 6) ────────────────────────────────

/**
 * Input for `transport.personaRender`.
 *
 * Mirrors the cli-services `personaRenderService` signature. Note that `home`
 * is part of the input only on the in-process path; the daemon transport
 * derives it from the daemon's `myClaudeHome` and never sends it over the
 * wire. The CLI command always passes a value so the in-proc path has it,
 * even when the call is later routed through the daemon.
 */
export interface TransportPersonaRenderInput {
  /** Role name (e.g. `"backend"`). */
  role: string;
  /** Auth profile id bound into the cascade. */
  authProfileId: string;
  /** Working directory for project-chain resolution. */
  cwd: string;
  /**
   * Absolute path to the myclaude home. Used only by the in-proc transport;
   * the daemon transport ignores it (the daemon derives `home` from its own
   * `myClaudeHome`).
   */
  home: string;
}

/**
 * Result of `transport.personaRender`.
 *
 * Re-exports the cli-services `PersonaRenderResult` so the CLI command layer
 * can format the output without re-declaring the shape. The daemon transport
 * reconstructs this shape from the wire response (see `daemon.ts`).
 */
export type TransportPersonaRenderResult = PersonaRenderResult;

/** Disposable handle returned by `transport.sessionsSubscribe`. */
export interface SessionsSubscribeHandle {
  /** Detach the listener; idempotent. */
  unsubscribe(): void;
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

  // ─── Session monitor (Phase 2 milestone 5) ────────────────────────────────

  /** Kill a running session by signalling its PID via the daemon. */
  sessionsKill(input: TransportSessionsKillInput): Promise<TransportSessionsKillResult>;

  /** Re-spawn a session under a freshly minted sessionId. Daemon-only. */
  sessionsRelaunch(input: TransportSessionsRelaunchInput): Promise<TransportSessionsRelaunchResult>;

  /** Recompute the launch hash for a session and diff against its captured hash. */
  sessionsDrift(input: TransportSessionsDriftInput): Promise<TransportSessionsDriftResult>;

  /**
   * Subscribe to push events from the daemon. Daemon-only — the in-process
   * transport raises daemonRequired().
   */
  sessionsSubscribe(input: TransportSessionsSubscribeInput): Promise<SessionsSubscribeHandle>;

  // ─── Persona render (Phase 2 milestone 6) ────────────────────────────────

  /**
   * Render the persona section in memory for the given identity tuple. Both
   * transports return the cli-services `PersonaRenderResult` shape; the
   * daemon transport reconstructs `targetPath` on missing-source entries as
   * an empty string (the daemon wire shape drops it — see ADR notes in the
   * milestone 6 plan).
   */
  personaRender(input: TransportPersonaRenderInput): Promise<TransportPersonaRenderResult>;

  /** Release any underlying connection. Idempotent and safe to call on either transport. */
  close(): Promise<void>;
}

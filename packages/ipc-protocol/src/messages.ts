/**
 * @module @agent-profile/ipc-protocol/messages
 *
 * Wire shapes for the daemon ↔ CLI IPC protocol.
 *
 * The protocol is a bidirectional, newline-delimited JSON stream over a Unix
 * Domain Socket (POSIX) or Named Pipe (Windows). Every message — request,
 * response, or unsolicited event — is a self-contained JSON object with an
 * `id` correlator and a `kind` discriminant.
 *
 * Design rules baked into the schemas below:
 *
 *  - **Discriminated unions on `kind`.** Both {@link Req} and {@link Resp} are
 *    `z.discriminatedUnion("kind", ...)` so a single `safeParse` call routes a
 *    parsed object to exactly one variant or rejects it.
 *  - **`id` is mandatory on every message.** Requests and responses share the
 *    same `id`; the codec layer is responsible for assigning fresh ids on
 *    outgoing requests and matching incoming responses back to in-flight
 *    promises.
 *  - **`unknown` for nested cascade payloads.** `profile.show.ok` and
 *    `sessions.list.ok` carry shapes that live in `@agent-profile/core` and
 *    `apps/cli` respectively. Re-validating those shapes here would create a
 *    circular dependency, so the wire schemas accept `z.unknown()` and the
 *    consumers Zod-narrow downstream.
 *  - **Closed `error.code` enum.** The IPC layer only emits the codes listed
 *    here. Application-level failure modes are represented by their own
 *    successful response variants where applicable; `error` is reserved for
 *    transport-level (auth, version, framing, routing) failures.
 *
 * The error codes match the table in `docs/05-gui-spec.md` and pair with CLI
 * exit code 4 (daemon unreachable) where the client cannot recover.
 */

import { z } from "zod";

// ─── Request schemas ──────────────────────────────────────────────────────────

/**
 * `hello` — the mandatory first message on every connection.
 *
 * Sent by the CLI immediately after `connect`. Carries the client's version
 * (for major-version handshake), the client `pid` (for audit + peer-cred
 * cross-check on the server side), and the boot cookie read from
 * `~/.myclaude/ipc-cookie`.
 */
export const ReqHello = z
  .object({
    id: z.string().min(1),
    kind: z.literal("hello"),
    clientVersion: z.string().min(1),
    pid: z.number().int().nonnegative(),
    cookie: z.string().min(1),
  })
  .strict();

/** Request to enumerate all known auth profiles (metadata only — no secret values). */
export const ReqAuthList = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.list"),
    includeRefs: z.boolean().optional(),
  })
  .strict();

/** Request the keyring URI for a single (authProfile, secret name) pair. */
export const ReqAuthGetSecretRef = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.get-secret-ref"),
    authId: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

/** Request the resolved effective config for a `(role, authProfileId, cwd)` triple. */
export const ReqProfileShow = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.show"),
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

/** Request the discovered scope files visible from the given cwd. */
export const ReqProfileList = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.list"),
    cwd: z.string().min(1),
    roleFilter: z.string().min(1).optional(),
  })
  .strict();

/** Validate a draft scope document without writing it to disk. */
export const ReqProfileValidate = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.validate"),
    content: z.unknown(),
  })
  .strict();

/** Preview a draft scope document as a highest-precedence launch override. */
export const ReqProfilePreview = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.preview"),
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
    draft: z
      .object({
        path: z.string().min(1),
        content: z.unknown(),
      })
      .strict(),
  })
  .strict();

/** Save a scope document to an allowlisted path. */
export const ReqProfileSave = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.save"),
    path: z.string().min(1),
    content: z.unknown(),
  })
  .strict();

/** Request to list active and recent sessions tracked by the daemon. */
export const ReqSessionsList = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.list"),
    activeOnly: z.boolean().optional(),
  })
  .strict();

/** Request lightweight daemon liveness/status info (PID, socket path, uptime, session counts). */
export const ReqDaemonStatus = z
  .object({
    id: z.string().min(1),
    kind: z.literal("daemon.status"),
  })
  .strict();

/**
 * Request graceful daemon shutdown.
 *
 * `force: true` skips the in-flight drain window and terminates active sessions
 * with SIGTERM. Without it, the daemon waits for sessions to finish.
 */
export const ReqDaemonStop = z
  .object({
    id: z.string().min(1),
    kind: z.literal("daemon.stop"),
    force: z.boolean().optional(),
  })
  .strict();

// ─── Write-side request schemas (Phase 2 milestone 3) ────────────────────────
//
// These kinds carry credential-bearing payloads. Every secret value travels as
// a base64 string (`*B64`) — the wire format never sees plaintext. The daemon
// is responsible for decoding, gating on capability tokens where required, and
// writing the audit trail.

/** Auth-profile metadata posted at `auth.add` time. Mirrors the YAML shape but adds nothing wire-specific. */
export const AuthProfileSpec = z
  .object({
    id: z.string().min(1),
    displayName: z.string().optional(),
    anthropic: z
      .object({
        mode: z.enum(["apiKey", "bedrock", "vertex", "gateway", "oauth"]),
        secretRef: z.string().min(1),
      })
      .strict(),
    mcpSecretRefs: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/**
 * Create a new auth profile and store its Anthropic secret.
 *
 * `anthropicSecretB64` is base64(plaintext). The daemon decodes, encrypts via
 * `safeStorage`, persists the metadata, and zeros the plaintext buffer.
 */
export const ReqAuthAdd = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.add"),
    spec: AuthProfileSpec,
    anthropicSecretB64: z.string().min(1),
    force: z.boolean().optional(),
  })
  .strict();

/**
 * Set or replace a single MCP secret on an existing auth profile.
 *
 * `register: true` creates the `mcpSecretRefs` entry on the fly when the name
 * is unknown; otherwise the daemon rejects with `BAD_REQUEST`.
 */
export const ReqAuthSetSecret = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.setSecret"),
    authId: z.string().min(1),
    name: z.string().min(1),
    valueB64: z.string().min(1),
    register: z.boolean().optional(),
  })
  .strict();

/**
 * Rotate the Anthropic secret on an existing auth profile.
 *
 * Issues an implicit `revokeSession` for every live capability bound to this
 * `authProfileId` so any in-flight `secret.get` calls fail fast.
 */
export const ReqAuthRotate = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.rotate"),
    authId: z.string().min(1),
    anthropicSecretB64: z.string().min(1),
  })
  .strict();

/**
 * Delete an auth profile and every keychain entry it owns.
 *
 * `yes` is advisory; the CLI confirms with the user before sending. The
 * daemon trusts the request once it arrives.
 */
export const ReqAuthRemove = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.remove"),
    authId: z.string().min(1),
    yes: z.boolean().optional(),
  })
  .strict();

/** Start an OAuth Authorization Code + PKCE flow for an Anthropic web subscription. */
export const ReqAuthOAuthStart = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.oauth.start"),
    profileId: z.string().min(1),
    displayName: z.string().optional(),
  })
  .strict();

/** Refresh the OAuth access token for an existing profile. */
export const ReqAuthOAuthRefresh = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.oauth.refresh"),
    authId: z.string().min(1),
  })
  .strict();

/** Detect existing Claude Code OAuth credentials in the OS keychain. */
export const ReqAuthOAuthDetect = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.oauth.detect"),
  })
  .strict();

/**
 * Begin a session and request a capability token.
 *
 * Default `ttlMs` (server-side): 60_000 for the initial token; the daemon may
 * extend the lifetime once the spawned process binds. `authProfileId` binds
 * later `secret.get` calls to a single auth profile. `launchHash` is the
 * launch-time effective-config digest captured by the caller (see
 * `computeLaunchHash` in `@agent-profile/cli-services`); the daemon stamps it
 * onto both its in-memory live-session entry and the persistent
 * `SessionRecord.launchHash` so the Session Monitor can later compare against
 * a freshly recomputed cascade and detect drift.
 */
export const ReqSessionStart = z
  .object({
    id: z.string().min(1),
    kind: z.literal("session.start"),
    sessionId: z.string().min(1),
    pid: z.number().int().nonnegative(),
    authProfileId: z.string().min(1).optional(),
    ttlMs: z.number().int().positive().optional(),
    launchHash: z.string().min(1).optional(),
  })
  .strict();

/** End a session and revoke every outstanding capability bound to it. */
export const ReqSessionEnd = z
  .object({
    id: z.string().min(1),
    kind: z.literal("session.end"),
    sessionId: z.string().min(1),
  })
  .strict();

/**
 * Fetch a secret on behalf of a spawned process.
 *
 * The daemon verifies the capability token, resolves `name` against the live
 * session's bound auth profile, and returns the value as base64. Any
 * verification failure (bad signature, expired, revoked) maps to `error.AUTH`.
 */
export const ReqSecretGet = z
  .object({
    id: z.string().min(1),
    kind: z.literal("secret.get"),
    capabilityToken: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

/**
 * Idempotent one-shot migration from `@napi-rs/keyring` to `safeStorage`.
 *
 * `dryRun: true` returns the plan without writing. `keepKeyring: true` (the
 * default daemon-side) leaves the keyring entries in place so standalone CLI
 * invocations retain read access.
 */
export const ReqSecretsMigrate = z
  .object({
    id: z.string().min(1),
    kind: z.literal("secrets.migrate"),
    dryRun: z.boolean().optional(),
    keepKeyring: z.boolean().optional(),
  })
  .strict();

// ─── Session monitor request schemas (Phase 2 milestone 5) ──────────────────
//
// The session monitor expands the read-only `sessions.list` surface with three
// mutating operations and one push-channel subscription:
//
//  - `sessions.kill` — stop a running session by signal.
//  - `sessions.relaunch` — re-spawn a session under a freshly minted id while
//    preserving the original's `(role, authProfileId, cwd)` tuple.
//  - `sessions.drift` — re-resolve the cascade for a live session and report
//    whether the effective config has drifted from the launch-time hash.
//  - `sessions.subscribe` — opt the connection into the unsolicited
//    `sessions.event` push channel; idempotent ack.

/** Request to kill a running session. The daemon honours optional signal selection. */
export const ReqSessionsKill = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.kill"),
    sessionId: z.string().min(1),
    signal: z.enum(["SIGTERM", "SIGKILL"]).optional(),
  })
  .strict();

/**
 * Request to relaunch a session.
 *
 * The daemon mints a new `sessionId` (linked back via `relaunchedFrom`) and
 * issues a fresh capability token bound to the same auth profile. The original
 * record is left intact for audit/lineage.
 */
export const ReqSessionsRelaunch = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.relaunch"),
    sessionId: z.string().min(1),
  })
  .strict();

/** Request to recompute the drift hash for a session and diff against its launch-time hash. */
export const ReqSessionsDrift = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.drift"),
    sessionId: z.string().min(1),
  })
  .strict();

/**
 * Request to subscribe the calling connection to the `sessions.event` push
 * channel.
 *
 * Idempotent — re-subscribing has no effect beyond a fresh ack. The server
 * tears the subscription down automatically when the socket closes.
 */
export const ReqSessionsSubscribe = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.subscribe"),
  })
  .strict();

// ─── Persona render request schemas (Phase 2 milestone 6) ───────────────────
//
// The persona composer adds a single read-only request kind that materialises
// the rendered CLAUDE.md fragments and per-category persona files (agents,
// skills, slashCmds, memory) for a `(role, authProfileId, cwd)` triple
// **without writing anything to disk**. The deployer's existing
// `deployPersona` path stays unchanged — this is a parallel in-memory path
// the GUI Persona Composer (and the new `myclaude render persona`
// subcommand) consumes for preview.

/**
 * Request the in-memory persona render for a `(role, authProfileId, cwd)`
 * triple.
 *
 * Mirrors {@link ReqProfileShow} structurally — same identity inputs, no
 * draft / override surface — but resolves all the way through the persona
 * deployer's read paths to produce concrete file contents. The response
 * carries utf-8 string content for every file (no base64; persona files are
 * not secrets — see ADR 005).
 */
export const ReqPersonaRender = z
  .object({
    id: z.string().min(1),
    kind: z.literal("persona.render"),
    role: z.string().min(1),
    authProfileId: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();

/**
 * Discriminated union of every request shape the daemon accepts.
 *
 * Add new request kinds by defining a new `Req<Kind>` schema above and
 * appending it to the union. The `kind` field must be a `z.literal(...)` so the
 * discriminated-union router can route parsed objects without ambiguity.
 */
export const Req = z.discriminatedUnion("kind", [
  ReqHello,
  ReqAuthList,
  ReqAuthGetSecretRef,
  ReqProfileShow,
  ReqProfileList,
  ReqProfileValidate,
  ReqProfilePreview,
  ReqSessionsList,
  ReqDaemonStatus,
  ReqDaemonStop,
  ReqProfileSave,
  ReqAuthAdd,
  ReqAuthSetSecret,
  ReqAuthRotate,
  ReqAuthRemove,
  ReqAuthOAuthStart,
  ReqAuthOAuthRefresh,
  ReqAuthOAuthDetect,
  ReqSessionStart,
  ReqSessionEnd,
  ReqSecretGet,
  ReqSecretsMigrate,
  ReqSessionsKill,
  ReqSessionsRelaunch,
  ReqSessionsDrift,
  ReqSessionsSubscribe,
  ReqPersonaRender,
]);

/** Static type for the {@link Req} discriminated union. */
export type ReqT = z.infer<typeof Req>;

/** Static type for `hello` requests. */
export type ReqHelloT = z.infer<typeof ReqHello>;
/** Static type for `auth.list` requests. */
export type ReqAuthListT = z.infer<typeof ReqAuthList>;
/** Static type for `auth.get-secret-ref` requests. */
export type ReqAuthGetSecretRefT = z.infer<typeof ReqAuthGetSecretRef>;
/** Static type for `profile.show` requests. */
export type ReqProfileShowT = z.infer<typeof ReqProfileShow>;
/** Static type for `profile.list` requests. */
export type ReqProfileListT = z.infer<typeof ReqProfileList>;
/** Static type for `profile.validate` requests. */
export type ReqProfileValidateT = z.infer<typeof ReqProfileValidate>;
/** Static type for `profile.preview` requests. */
export type ReqProfilePreviewT = z.infer<typeof ReqProfilePreview>;
/** Static type for `sessions.list` requests. */
export type ReqSessionsListT = z.infer<typeof ReqSessionsList>;
/** Static type for `daemon.status` requests. */
export type ReqDaemonStatusT = z.infer<typeof ReqDaemonStatus>;
/** Static type for `daemon.stop` requests. */
export type ReqDaemonStopT = z.infer<typeof ReqDaemonStop>;
/** Static type for `profile.save` requests. */
export type ReqProfileSaveT = z.infer<typeof ReqProfileSave>;
/** Static type for `auth.add` requests (write-side). */
export type ReqAuthAddT = z.infer<typeof ReqAuthAdd>;
/** Static type for `auth.setSecret` requests (write-side). */
export type ReqAuthSetSecretT = z.infer<typeof ReqAuthSetSecret>;
/** Static type for `auth.rotate` requests (write-side). */
export type ReqAuthRotateT = z.infer<typeof ReqAuthRotate>;
/** Static type for `auth.remove` requests (write-side). */
export type ReqAuthRemoveT = z.infer<typeof ReqAuthRemove>;
/** Static type for `auth.oauth.start` requests. */
export type ReqAuthOAuthStartT = z.infer<typeof ReqAuthOAuthStart>;
/** Static type for `auth.oauth.refresh` requests. */
export type ReqAuthOAuthRefreshT = z.infer<typeof ReqAuthOAuthRefresh>;
/** Static type for `auth.oauth.detect` requests. */
export type ReqAuthOAuthDetectT = z.infer<typeof ReqAuthOAuthDetect>;
/** Static type for `session.start` requests (issues a capability token). */
export type ReqSessionStartT = z.infer<typeof ReqSessionStart>;
/** Static type for `session.end` requests (revokes capabilities). */
export type ReqSessionEndT = z.infer<typeof ReqSessionEnd>;
/** Static type for `secret.get` requests (capability-token-gated). */
export type ReqSecretGetT = z.infer<typeof ReqSecretGet>;
/** Static type for `secrets.migrate` requests. */
export type ReqSecretsMigrateT = z.infer<typeof ReqSecretsMigrate>;
/** Static type for `sessions.kill` requests. */
export type ReqSessionsKillT = z.infer<typeof ReqSessionsKill>;
/** Static type for `sessions.relaunch` requests. */
export type ReqSessionsRelaunchT = z.infer<typeof ReqSessionsRelaunch>;
/** Static type for `sessions.drift` requests. */
export type ReqSessionsDriftT = z.infer<typeof ReqSessionsDrift>;
/** Static type for `sessions.subscribe` requests. */
export type ReqSessionsSubscribeT = z.infer<typeof ReqSessionsSubscribe>;
/** Static type for `persona.render` requests. */
export type ReqPersonaRenderT = z.infer<typeof ReqPersonaRender>;
/** Auth profile metadata embedded in `ReqAuthAdd.spec`. */
export type AuthProfileSpecT = z.infer<typeof AuthProfileSpec>;

// ─── Response schemas ─────────────────────────────────────────────────────────

/**
 * Successful handshake response.
 *
 * `accepted: true` confirms cookie + version match. `features` lists capability
 * tags (e.g. `"resolve"`, `"sessions.*"`, `"secret.get"`) the client may rely
 * on; the client should treat unknown tags as opaque so newer servers can add
 * features without breaking older clients.
 */
export const RespHelloOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("hello.ok"),
    serverVersion: z.string().min(1),
    accepted: z.boolean(),
    features: z.array(z.string()),
  })
  .strict();

/** Response to `auth.list`. Each entry is metadata only — `secrets` is a list of names, not values. */
export const RespAuthListOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.list.ok"),
    profiles: z.array(
      z
        .object({
          id: z.string().min(1),
          displayName: z.string(),
          mode: z.string().min(1),
          secrets: z.array(z.string()),
        })
        .strict()
    ),
  })
  .strict();

/** Response to `auth.get-secret-ref`. `null` ref means "no such secret in this auth profile". */
export const RespAuthGetSecretRefOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.get-secret-ref.ok"),
    ref: z.string().nullable(),
  })
  .strict();

/**
 * Response to `profile.show`.
 *
 * The `effective` and `provenance` payloads are typed as `unknown` here because
 * their concrete shapes (`EffectiveConfig`, `Provenance`) live in
 * `@agent-profile/core`. Importing those types here would create a cycle —
 * `core` does not depend on `ipc-protocol`, and we want to keep it that way.
 * Consumers (`apps/cli`, `apps/desktop`) re-validate against the core schemas.
 */
export const RespProfileShowOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.show.ok"),
    effective: z.unknown(),
    provenance: z.unknown(),
  })
  .strict();

const ProfileIssue = z
  .object({
    path: z.string(),
    message: z.string().min(1),
    code: z.string().min(1),
  })
  .strict();

const ProfileScopeEntry = z
  .object({
    scope: z.string().min(1),
    role: z.string().nullable(),
    filePath: z.string().min(1),
    content: z.unknown().nullable(),
    /** Optional per-file read/parse/validation issues. Empty arrays are omitted. */
    issues: z.array(ProfileIssue).optional(),
  })
  .strict();

const ProfilePreviewPayload = z
  .object({
    effective: z.unknown(),
    provenance: z.unknown(),
  })
  .strict();

const ProfileDiffEntry = z
  .object({
    path: z.string().min(1),
    change: z.enum(["added", "removed", "changed"]),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .strict();

/** Response to `profile.list`. */
export const RespProfileListOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.list.ok"),
    scopes: z.array(ProfileScopeEntry),
  })
  .strict();

/** Response to `profile.validate`. */
export const RespProfileValidateOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.validate.ok"),
    issues: z.array(ProfileIssue),
  })
  .strict();

/** Response to `profile.preview`. */
export const RespProfilePreviewOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.preview.ok"),
    issues: z.array(ProfileIssue),
    current: ProfilePreviewPayload,
    preview: ProfilePreviewPayload.nullable(),
    diff: z.array(ProfileDiffEntry),
  })
  .strict();

/**
 * Optional per-record enrichment the daemon path attaches to each entry in
 * `sessions.list.ok`.
 *
 * The fields are populated only by the daemon transport (which has access to
 * the live capability table and can probe PID liveness via `process.kill(pid,
 * 0)`). The standalone in-process transport and older daemons omit them.
 *
 *  - `liveCapability` — `true` if the capability table currently holds a
 *    non-revoked entry for this session.
 *  - `capabilityExpiresAtMs` — absolute epoch when the live capability
 *    expires; only meaningful when `liveCapability` is `true`.
 *  - `processAlive` — `true` if `process.kill(pid, 0)` succeeded.
 *
 * The schema is `passthrough()` so the underlying record shape (which lives
 * in `apps/cli`) is preserved verbatim; it merely adds the optional fields
 * the Session Monitor wants to surface.
 */
export const SessionRecordEnrichment = z
  .object({
    liveCapability: z.boolean().optional(),
    capabilityExpiresAtMs: z.number().int().nonnegative().optional(),
    processAlive: z.boolean().optional(),
  })
  .passthrough();

/**
 * Response to `sessions.list`.
 *
 * Session record shapes currently live in `apps/cli`. We keep them loose
 * (`z.unknown()`) on the wire until they migrate into a shared package — but
 * the daemon path enriches each record with the optional fields described in
 * {@link SessionRecordEnrichment} so the Session Monitor can display
 * capability + process liveness without round-tripping back to the daemon.
 *
 * Older daemons and the standalone in-process transport omit the enrichment
 * fields entirely. The wire schema stays `z.unknown()` so it is
 * back-compatible regardless of whether the enrichment is present; consumers
 * Zod-narrow with {@link SessionRecordEnrichment} when they want to pull the
 * enrichment fields off a record.
 */
export const RespSessionsListOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.list.ok"),
    sessions: z.array(z.unknown()),
  })
  .strict();

/** Response to `daemon.status`. */
export const RespDaemonStatusOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("daemon.status.ok"),
    pid: z.number().int().nonnegative(),
    socketPath: z.string().min(1),
    uptimeMs: z.number().nonnegative(),
    sessionCounts: z
      .object({
        active: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** Response to `daemon.stop`. The daemon emits this immediately before tearing down the listener. */
export const RespDaemonStopOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("daemon.stop.ok"),
  })
  .strict();

/** Response to `profile.save`. */
export const RespProfileSaveOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("profile.save.ok"),
    saved: z.literal(true),
    path: z.string().min(1),
  })
  .strict();

/**
 * Transport-level error response.
 *
 * Returned by the server when a request cannot be processed at the IPC layer
 * (auth failure, version skew, malformed body, missing route handler, or an
 * unexpected internal failure). Application-level failures should use a
 * domain-specific response variant where possible; `error` is the generic
 * fallback.
 */
export const RespError = z
  .object({
    id: z.string().min(1),
    kind: z.literal("error"),
    code: z.enum(["AUTH", "AUTH_VERSION", "BAD_COOKIE", "NOT_FOUND", "BAD_REQUEST", "INTERNAL"]),
    reason: z.string(),
    requestKind: z.string().optional(),
  })
  .strict();

// ─── Write-side response schemas (Phase 2 milestone 3) ───────────────────────

/** Response to `auth.add`. The body is empty; success is indicated by the kind. */
export const RespAuthAddOk = z
  .object({ id: z.string().min(1), kind: z.literal("auth.add.ok") })
  .strict();

/** Response to `auth.setSecret`. */
export const RespAuthSetSecretOk = z
  .object({ id: z.string().min(1), kind: z.literal("auth.setSecret.ok") })
  .strict();

/** Response to `auth.rotate`. */
export const RespAuthRotateOk = z
  .object({ id: z.string().min(1), kind: z.literal("auth.rotate.ok") })
  .strict();

/**
 * Response to `auth.remove`.
 *
 * `failed` lists the secret names whose keychain delete failed; the metadata
 * is always removed regardless. CLI surfaces a partial-success message when
 * `failed.length > 0`.
 */
export const RespAuthRemoveOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.remove.ok"),
    failed: z.array(z.string()),
  })
  .strict();

/** Response to `auth.oauth.start`. */
export const RespAuthOAuthStartOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.oauth.start.ok"),
    profileId: z.string().min(1),
    oauth: z
      .object({
        email: z.string().optional(),
        orgName: z.string().optional(),
        planType: z.string().optional(),
      })
      .optional(),
  })
  .strict();

/** Response to `auth.oauth.refresh`. */
export const RespAuthOAuthRefreshOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.oauth.refresh.ok"),
    refreshed: z.literal(true),
    accessTokenExpiresAt: z.string().optional(),
  })
  .strict();

/** Response to `auth.oauth.detect`. */
export const RespAuthOAuthDetectOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("auth.oauth.detect.ok"),
    detected: z.boolean(),
    email: z.string().optional(),
    orgName: z.string().optional(),
    planType: z.string().optional(),
    accessTokenExpiresAt: z.string().optional(),
  })
  .strict();

/**
 * Response to `session.start`. Carries the freshly minted capability token
 * and its absolute expiry epoch.
 */
export const RespSessionStartOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("session.start.ok"),
    capabilityToken: z.string().min(1),
    expiresAtMs: z.number().int().nonnegative(),
  })
  .strict();

/** Response to `session.end`. */
export const RespSessionEndOk = z
  .object({ id: z.string().min(1), kind: z.literal("session.end.ok") })
  .strict();

/**
 * Response to `secret.get`.
 *
 * `valueB64` is the base64-encoded secret value. The daemon never returns
 * plaintext on the wire; consumers decode just-in-time.
 */
export const RespSecretGetOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("secret.get.ok"),
    valueB64: z.string().min(1),
  })
  .strict();

/**
 * Response to `secrets.migrate`. The four counters always sum to `scanned`
 * (`migrated + skipped + errors.length === scanned`); CLI surfaces them
 * verbatim.
 */
export const RespSecretsMigrateOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("secrets.migrate.ok"),
    scanned: z.number().int().nonnegative(),
    migrated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z.array(
      z
        .object({
          key: z.string(),
          reason: z.string(),
        })
        .strict()
    ),
  })
  .strict();

// ─── Session monitor response schemas (Phase 2 milestone 5) ─────────────────

/**
 * Response to `sessions.kill`.
 *
 * `killed` is `true` when the daemon successfully delivered the requested
 * signal to the live PID. `exitCode` is included when the daemon observed the
 * child exit before the response was queued.
 */
export const RespSessionsKillOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.kill.ok"),
    killed: z.boolean(),
    exitCode: z.number().int().optional(),
  })
  .strict();

/**
 * Response to `sessions.relaunch`.
 *
 * Carries the freshly minted `sessionId`, the new capability token + expiry,
 * and `relaunchedFrom` linking back to the original session. The original
 * record is left intact for audit/lineage.
 */
export const RespSessionsRelaunchOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.relaunch.ok"),
    sessionId: z.string().min(1),
    capabilityToken: z.string().min(1),
    expiresAtMs: z.number().int().nonnegative(),
    relaunchedFrom: z.string().min(1),
  })
  .strict();

/**
 * Response to `sessions.drift`.
 *
 * `drifted` is `true` when `newHash !== oldHash`. `scopesChanged` lists scope
 * paths whose contents differ between the launch-time provenance and the
 * just-recomputed cascade; an empty array means the hashes drifted but the
 * scope-file diff is empty (e.g. an authProfile rotation invalidated the
 * effective config without changing any scope file).
 */
export const RespSessionsDriftOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.drift.ok"),
    drifted: z.boolean(),
    scopesChanged: z.array(z.string()),
    oldHash: z.string(),
    newHash: z.string(),
  })
  .strict();

/**
 * Response to `sessions.subscribe`.
 *
 * `subscribed: true` is a bare ack. The server tears the subscription down
 * automatically when the socket closes; there is no `unsubscribe` request —
 * close the connection (or send another `sessions.subscribe`, which is
 * idempotent).
 */
export const RespSessionsSubscribeOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("sessions.subscribe.ok"),
    subscribed: z.literal(true),
  })
  .strict();

// ─── Persona render response schemas (Phase 2 milestone 6) ──────────────────
//
// `persona.render.ok` carries the in-memory render output: a combined
// CLAUDE.md (with per-source breakdown) and the flat list of per-category
// persona files (agents, skills, slashCmds, memory). Every content field is a
// utf-8 string — persona files are markdown / yaml / json text and are not
// secrets, so the wire format does not base64-encode them. Secret refs that
// happen to appear as `${secret:...}` placeholders inside fragment bodies
// pass through verbatim; plaintext secrets never enter this payload (cascade
// resolution is a separate launch-time step).

/**
 * One persona file the renderer materialised from disk.
 *
 * `category` distinguishes the four flat categories the deployer copies into
 * `~/.claude/{agents,skills,commands,memory}/`. The single combined CLAUDE.md
 * lives outside this list — see {@link RespPersonaRenderOk.claudeMd}.
 *
 *  - `sourcePath` — absolute path on disk where the file was read from.
 *  - `originScope` — the scope name (e.g. `"global-role"`,
 *    `"project-shared"`) that won the cascade for this file.
 *  - `content` — the raw utf-8 file body.
 */
export const PersonaFileWire = z
  .object({
    category: z.enum(["agents", "skills", "slashCmds", "memory"]),
    basename: z.string().min(1),
    sourcePath: z.string().min(1),
    originScope: z.string().min(1),
    content: z.string(),
  })
  .strict();

/**
 * One CLAUDE.md fragment that contributed to the combined render.
 *
 * The combined CLAUDE.md is the cascade-ordered concatenation of every
 * fragment; `sections` exposes the per-source slices so the Composer UI can
 * highlight which scope contributed which paragraph. `content` is the raw
 * fragment body (no `<!-- source: ... -->` marker prefix).
 */
export const PersonaClaudeMdSection = z
  .object({
    sourcePath: z.string().min(1),
    originScope: z.string().min(1),
    content: z.string(),
  })
  .strict();

/**
 * One collision the deployer detected for a persona file.
 *
 * A collision occurs when more than one scope contributes a file of the same
 * basename within the same category. `winningSource` is the cascade-winning
 * source path; `overriddenSources` lists the loser source paths in cascade
 * order (oldest → newest before the winner).
 */
export const PersonaCollisionWire = z
  .object({
    category: z.enum(["agents", "skills", "slashCmds", "memory"]),
    basename: z.string().min(1),
    winningSource: z.string().min(1),
    overriddenSources: z.array(z.string()),
  })
  .strict();

/**
 * One missing source the deployer encountered.
 *
 * `category` includes `"claudeMd"` because a missing CLAUDE.md fragment is
 * collapsed into the single combined render and so does not appear in
 * {@link RespPersonaRenderOk.files}; the rest of the categories
 * (`"agents"`, `"skills"`, `"slashCmds"`, `"memory"`) are flat per-file
 * entries that just go absent on a successful render.
 */
export const PersonaMissingWire = z
  .object({
    category: z.enum(["claudeMd", "agents", "skills", "slashCmds", "memory"]),
    sourcePath: z.string().min(1),
  })
  .strict();

/**
 * Response to `persona.render`.
 *
 * `claudeMd` is `null` when no scope contributed a CLAUDE.md fragment;
 * otherwise it carries the combined render and the per-source breakdown.
 * `files` is the flat list of agents / skills / slashCmds / memory files.
 * `collisions` and `missingSources` mirror the deployer's existing
 * collision-log and missing-source-entry shapes for UI surfacing.
 */
export const RespPersonaRenderOk = z
  .object({
    id: z.string().min(1),
    kind: z.literal("persona.render.ok"),
    claudeMd: z
      .object({
        combinedContent: z.string(),
        sections: z.array(PersonaClaudeMdSection),
      })
      .strict()
      .nullable(),
    files: z.array(PersonaFileWire),
    collisions: z.array(PersonaCollisionWire),
    missingSources: z.array(PersonaMissingWire),
  })
  .strict();

/**
 * Discriminated union of every response shape.
 *
 * Note: `error` is part of the union because every request kind may resolve to
 * either its `<kind>.ok` shape or a generic `error`. The client's per-id
 * promise routing dispatches by `id` first; the shape check by `kind` happens
 * inside the resolver.
 */
export const Resp = z.discriminatedUnion("kind", [
  RespHelloOk,
  RespAuthListOk,
  RespAuthGetSecretRefOk,
  RespProfileShowOk,
  RespProfileListOk,
  RespProfileValidateOk,
  RespProfilePreviewOk,
  RespSessionsListOk,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespProfileSaveOk,
  RespError,
  RespAuthAddOk,
  RespAuthSetSecretOk,
  RespAuthRotateOk,
  RespAuthRemoveOk,
  RespAuthOAuthStartOk,
  RespAuthOAuthRefreshOk,
  RespAuthOAuthDetectOk,
  RespSessionStartOk,
  RespSessionEndOk,
  RespSecretGetOk,
  RespSecretsMigrateOk,
  RespSessionsKillOk,
  RespSessionsRelaunchOk,
  RespSessionsDriftOk,
  RespSessionsSubscribeOk,
  RespPersonaRenderOk,
]);

// ─── Event schemas (Phase 2 milestone 5 — push channel) ─────────────────────
//
// The third envelope type. Event frames are unsolicited push messages emitted
// by the server to subscribed connections. Two structural differences from
// the request/response envelope:
//
//  - There is no `id` field. Events are not correlated to any pending
//    request; the client routes them by `kind` discriminator only.
//  - There is no `error` variant. If the server cannot construct an event,
//    it simply does not emit; transport errors close the socket and are
//    surfaced through the in-flight request mechanism instead.

/**
 * Push frame emitted to subscribed connections whenever a session's lifecycle
 * state changes.
 *
 * `event` is the lifecycle transition. `exitCode` accompanies `"exited"` and
 * `"killed"` events when the daemon observed the child exit. `ts` is the
 * server-side wall-clock millisecond at the time the event was recorded;
 * monotonically increasing in practice but not guaranteed across reboots.
 */
export const EvtSessionsEvent = z
  .object({
    kind: z.literal("sessions.event"),
    sessionId: z.string().min(1),
    event: z.enum(["started", "idle", "exited", "killed", "drifted"]),
    exitCode: z.number().int().optional(),
    ts: z.number(),
  })
  .strict();

/**
 * Discriminated union of every event shape.
 *
 * The union has a single member today; it is shaped as a union so future
 * channels (e.g. `auth.event`, `daemon.event`) can be added without
 * destabilising downstream Zod call sites.
 */
export const Evt = z.discriminatedUnion("kind", [EvtSessionsEvent]);

/**
 * Discriminated union of every frame the server can write on a connection —
 * responses (`Resp`) and unsolicited events (`Evt`).
 *
 * Clients that demultiplex the incoming stream parse with `Frame.safeParse`
 * and route by the presence of `id`: response frames carry an `id` correlator
 * tied to a pending request; event frames have no `id` and dispatch via the
 * client's emitter API.
 */
export const Frame = z.discriminatedUnion("kind", [
  RespHelloOk,
  RespAuthListOk,
  RespAuthGetSecretRefOk,
  RespProfileShowOk,
  RespProfileListOk,
  RespProfileValidateOk,
  RespProfilePreviewOk,
  RespSessionsListOk,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespProfileSaveOk,
  RespError,
  RespAuthAddOk,
  RespAuthSetSecretOk,
  RespAuthRotateOk,
  RespAuthRemoveOk,
  RespAuthOAuthStartOk,
  RespAuthOAuthRefreshOk,
  RespAuthOAuthDetectOk,
  RespSessionStartOk,
  RespSessionEndOk,
  RespSecretGetOk,
  RespSecretsMigrateOk,
  RespSessionsKillOk,
  RespSessionsRelaunchOk,
  RespSessionsDriftOk,
  RespSessionsSubscribeOk,
  EvtSessionsEvent,
  RespPersonaRenderOk,
]);

/** Static type for the {@link Resp} discriminated union. */
export type RespT = z.infer<typeof Resp>;

/** Static type for `hello.ok` responses. */
export type RespHelloOkT = z.infer<typeof RespHelloOk>;
/** Static type for `auth.list.ok` responses. */
export type RespAuthListOkT = z.infer<typeof RespAuthListOk>;
/** Static type for `auth.get-secret-ref.ok` responses. */
export type RespAuthGetSecretRefOkT = z.infer<typeof RespAuthGetSecretRefOk>;
/** Static type for `profile.show.ok` responses. */
export type RespProfileShowOkT = z.infer<typeof RespProfileShowOk>;
/** Static type for `profile.list.ok` responses. */
export type RespProfileListOkT = z.infer<typeof RespProfileListOk>;
/** Static type for `profile.validate.ok` responses. */
export type RespProfileValidateOkT = z.infer<typeof RespProfileValidateOk>;
/** Static type for `profile.preview.ok` responses. */
export type RespProfilePreviewOkT = z.infer<typeof RespProfilePreviewOk>;
/** Static type for `sessions.list.ok` responses. */
export type RespSessionsListOkT = z.infer<typeof RespSessionsListOk>;
/** Static type for `daemon.status.ok` responses. */
export type RespDaemonStatusOkT = z.infer<typeof RespDaemonStatusOk>;
/** Static type for `daemon.stop.ok` responses. */
export type RespDaemonStopOkT = z.infer<typeof RespDaemonStopOk>;
/** Static type for `profile.save.ok` responses. */
export type RespProfileSaveOkT = z.infer<typeof RespProfileSaveOk>;
/** Static type for transport-level `error` responses. */
export type RespErrorT = z.infer<typeof RespError>;
/** Static type for `auth.add.ok` responses. */
export type RespAuthAddOkT = z.infer<typeof RespAuthAddOk>;
/** Static type for `auth.setSecret.ok` responses. */
export type RespAuthSetSecretOkT = z.infer<typeof RespAuthSetSecretOk>;
/** Static type for `auth.rotate.ok` responses. */
export type RespAuthRotateOkT = z.infer<typeof RespAuthRotateOk>;
/** Static type for `auth.remove.ok` responses. */
export type RespAuthRemoveOkT = z.infer<typeof RespAuthRemoveOk>;
/** Static type for `auth.oauth.start.ok` responses. */
export type RespAuthOAuthStartOkT = z.infer<typeof RespAuthOAuthStartOk>;
/** Static type for `auth.oauth.refresh.ok` responses. */
export type RespAuthOAuthRefreshOkT = z.infer<typeof RespAuthOAuthRefreshOk>;
/** Static type for `auth.oauth.detect.ok` responses. */
export type RespAuthOAuthDetectOkT = z.infer<typeof RespAuthOAuthDetectOk>;
/** Static type for `session.start.ok` responses. */
export type RespSessionStartOkT = z.infer<typeof RespSessionStartOk>;
/** Static type for `session.end.ok` responses. */
export type RespSessionEndOkT = z.infer<typeof RespSessionEndOk>;
/** Static type for `secret.get.ok` responses. */
export type RespSecretGetOkT = z.infer<typeof RespSecretGetOk>;
/** Static type for `secrets.migrate.ok` responses. */
export type RespSecretsMigrateOkT = z.infer<typeof RespSecretsMigrateOk>;
/** Static type for `sessions.kill.ok` responses. */
export type RespSessionsKillOkT = z.infer<typeof RespSessionsKillOk>;
/** Static type for `sessions.relaunch.ok` responses. */
export type RespSessionsRelaunchOkT = z.infer<typeof RespSessionsRelaunchOk>;
/** Static type for `sessions.drift.ok` responses. */
export type RespSessionsDriftOkT = z.infer<typeof RespSessionsDriftOk>;
/** Static type for `sessions.subscribe.ok` responses. */
export type RespSessionsSubscribeOkT = z.infer<typeof RespSessionsSubscribeOk>;
/** Static type for `persona.render.ok` responses. */
export type RespPersonaRenderOkT = z.infer<typeof RespPersonaRenderOk>;
/** Static type for a single persona file entry on the wire. */
export type PersonaFileWireT = z.infer<typeof PersonaFileWire>;
/** Static type for one CLAUDE.md fragment slice on the wire. */
export type PersonaClaudeMdSectionT = z.infer<typeof PersonaClaudeMdSection>;
/** Static type for a persona collision entry on the wire. */
export type PersonaCollisionWireT = z.infer<typeof PersonaCollisionWire>;
/** Static type for a missing-source entry on the wire. */
export type PersonaMissingWireT = z.infer<typeof PersonaMissingWire>;
/** Static type for a profile validation issue. */
export type ProfileIssueT = z.infer<typeof ProfileIssue>;
/** Static type for a discovered scope entry. */
export type ProfileScopeEntryT = z.infer<typeof ProfileScopeEntry>;
/** Static type for a preview payload. */
export type ProfilePreviewPayloadT = z.infer<typeof ProfilePreviewPayload>;
/** Static type for a compact preview diff entry. */
export type ProfileDiffEntryT = z.infer<typeof ProfileDiffEntry>;
/** Static type for the optional per-record enrichment in `sessions.list.ok`. */
export type SessionRecordEnrichmentT = z.infer<typeof SessionRecordEnrichment>;

/** Static type for the {@link Evt} discriminated union. */
export type EvtT = z.infer<typeof Evt>;
/** Static type for `sessions.event` push frames. */
export type EvtSessionsEventT = z.infer<typeof EvtSessionsEvent>;
/** Static type for the {@link Frame} discriminated union (responses ∪ events). */
export type FrameT = z.infer<typeof Frame>;

/** Closed enum of error codes the IPC layer is allowed to emit. */
export type IpcErrorCode = RespErrorT["code"];

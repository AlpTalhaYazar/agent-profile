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
        mode: z.enum(["apiKey", "bedrock", "vertex", "gateway"]),
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

/**
 * Begin a session and request a capability token.
 *
 * Default `ttlMs` (server-side): 60_000 for the initial token; the daemon may
 * extend the lifetime once the spawned process binds. `authProfileId` binds
 * later `secret.get` calls to a single auth profile.
 */
export const ReqSessionStart = z
  .object({
    id: z.string().min(1),
    kind: z.literal("session.start"),
    sessionId: z.string().min(1),
    pid: z.number().int().nonnegative(),
    authProfileId: z.string().min(1).optional(),
    ttlMs: z.number().int().positive().optional(),
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
  ReqSessionStart,
  ReqSessionEnd,
  ReqSecretGet,
  ReqSecretsMigrate,
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
/** Static type for `session.start` requests (issues a capability token). */
export type ReqSessionStartT = z.infer<typeof ReqSessionStart>;
/** Static type for `session.end` requests (revokes capabilities). */
export type ReqSessionEndT = z.infer<typeof ReqSessionEnd>;
/** Static type for `secret.get` requests (capability-token-gated). */
export type ReqSecretGetT = z.infer<typeof ReqSecretGet>;
/** Static type for `secrets.migrate` requests. */
export type ReqSecretsMigrateT = z.infer<typeof ReqSecretsMigrate>;
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
 * Response to `sessions.list`.
 *
 * Session record shapes currently live in `apps/cli`. We keep them loose
 * (`z.unknown()`) on the wire until they migrate into a shared package.
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
  RespSessionStartOk,
  RespSessionEndOk,
  RespSecretGetOk,
  RespSecretsMigrateOk,
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
/** Static type for `session.start.ok` responses. */
export type RespSessionStartOkT = z.infer<typeof RespSessionStartOk>;
/** Static type for `session.end.ok` responses. */
export type RespSessionEndOkT = z.infer<typeof RespSessionEndOk>;
/** Static type for `secret.get.ok` responses. */
export type RespSecretGetOkT = z.infer<typeof RespSecretGetOk>;
/** Static type for `secrets.migrate.ok` responses. */
export type RespSecretsMigrateOkT = z.infer<typeof RespSecretsMigrateOk>;
/** Static type for a profile validation issue. */
export type ProfileIssueT = z.infer<typeof ProfileIssue>;
/** Static type for a discovered scope entry. */
export type ProfileScopeEntryT = z.infer<typeof ProfileScopeEntry>;
/** Static type for a preview payload. */
export type ProfilePreviewPayloadT = z.infer<typeof ProfilePreviewPayload>;
/** Static type for a compact preview diff entry. */
export type ProfileDiffEntryT = z.infer<typeof ProfileDiffEntry>;

/** Closed enum of error codes the IPC layer is allowed to emit. */
export type IpcErrorCode = RespErrorT["code"];

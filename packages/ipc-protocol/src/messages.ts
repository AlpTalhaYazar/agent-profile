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
  ReqSessionsList,
  ReqDaemonStatus,
  ReqDaemonStop,
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
/** Static type for `sessions.list` requests. */
export type ReqSessionsListT = z.infer<typeof ReqSessionsList>;
/** Static type for `daemon.status` requests. */
export type ReqDaemonStatusT = z.infer<typeof ReqDaemonStatus>;
/** Static type for `daemon.stop` requests. */
export type ReqDaemonStopT = z.infer<typeof ReqDaemonStop>;

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
  RespSessionsListOk,
  RespDaemonStatusOk,
  RespDaemonStopOk,
  RespError,
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
/** Static type for `sessions.list.ok` responses. */
export type RespSessionsListOkT = z.infer<typeof RespSessionsListOk>;
/** Static type for `daemon.status.ok` responses. */
export type RespDaemonStatusOkT = z.infer<typeof RespDaemonStatusOk>;
/** Static type for `daemon.stop.ok` responses. */
export type RespDaemonStopOkT = z.infer<typeof RespDaemonStopOk>;
/** Static type for transport-level `error` responses. */
export type RespErrorT = z.infer<typeof RespError>;

/** Closed enum of error codes the IPC layer is allowed to emit. */
export type IpcErrorCode = RespErrorT["code"];

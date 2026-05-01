import { z } from "zod";

const NonEmptyString = z.string().min(1);
const KeyringRef = z.string().regex(/^keyring:\/\//);

const AuthOAuthMetadata = z
  .object({
    email: z.string().optional(),
    orgName: z.string().optional(),
    planType: z.string().optional(),
    accessTokenExpiresAt: z.string().optional(),
    refreshTokenRef: KeyringRef.optional(),
  })
  .strict();

/** Auth-profile metadata posted at `auth.add` time. Mirrors the YAML shape but adds nothing wire-specific. */
export const AuthProfileSpec = z
  .object({
    id: NonEmptyString,
    displayName: z.string().optional(),
    anthropic: z
      .object({
        mode: z.enum(["apiKey", "bedrock", "vertex", "gateway", "oauth"]),
        secretRef: NonEmptyString,
        /** OAuth-specific metadata. Present only when mode is "oauth". */
        oauth: AuthOAuthMetadata.optional(),
      })
      .strict(),
    mcpSecretRefs: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** Request to enumerate all known auth profiles (metadata only — no secret values). */
export const ReqAuthList = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.list"),
    includeRefs: z.boolean().optional(),
  })
  .strict();

/** Request the keyring URI for a single (authProfile, secret name) pair. */
export const ReqAuthGetSecretRef = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.get-secret-ref"),
    authId: NonEmptyString,
    name: NonEmptyString,
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
    id: NonEmptyString,
    kind: z.literal("auth.add"),
    spec: AuthProfileSpec,
    anthropicSecretB64: NonEmptyString,
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
    id: NonEmptyString,
    kind: z.literal("auth.setSecret"),
    authId: NonEmptyString,
    name: NonEmptyString,
    valueB64: NonEmptyString,
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
    id: NonEmptyString,
    kind: z.literal("auth.rotate"),
    authId: NonEmptyString,
    anthropicSecretB64: NonEmptyString,
  })
  .strict();

/**
 * Update non-secret metadata on an existing auth profile.
 *
 * Only fields that do NOT touch the keychain are settable: `displayName` and
 * the OAuth metadata block. To change the Anthropic secret, use `auth.rotate`;
 * to add or replace a profile from scratch, use `auth.add`.
 */
export const ReqAuthUpdateMeta = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.update-meta"),
    authId: NonEmptyString,
    displayName: z.string().optional(),
    oauth: AuthOAuthMetadata.optional(),
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
    id: NonEmptyString,
    kind: z.literal("auth.remove"),
    authId: NonEmptyString,
    yes: z.boolean().optional(),
  })
  .strict();

/** Start an OAuth Authorization Code + PKCE flow for an Anthropic web subscription. */
export const ReqAuthOAuthStart = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.oauth.start"),
    profileId: NonEmptyString,
    displayName: z.string().optional(),
  })
  .strict();

/** Refresh the OAuth access token for an existing profile. */
export const ReqAuthOAuthRefresh = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.oauth.refresh"),
    authId: NonEmptyString,
  })
  .strict();

/** Detect existing Claude Code OAuth credentials in the OS keychain. */
export const ReqAuthOAuthDetect = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.oauth.detect"),
  })
  .strict();

const RespAuthListProfileOAuth = z
  .object({
    email: z.string().optional(),
    orgName: z.string().optional(),
    planType: z.string().optional(),
    accessTokenExpiresAt: z.string().optional(),
    refreshTokenRef: z.string().optional(),
  })
  .strict();

/** Response to `auth.list`. Each entry is metadata only — `secrets` is a list of names, not values. */
export const RespAuthListOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.list.ok"),
    profiles: z.array(
      z
        .object({
          id: NonEmptyString,
          displayName: z.string(),
          mode: NonEmptyString,
          secrets: z.array(z.string()),
          oauth: RespAuthListProfileOAuth.optional(),
        })
        .strict()
    ),
  })
  .strict();

/** Response to `auth.get-secret-ref`. `null` ref means "no such secret in this auth profile". */
export const RespAuthGetSecretRefOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.get-secret-ref.ok"),
    ref: z.string().nullable(),
  })
  .strict();

/** Response to `auth.add`. The body is empty; success is indicated by the kind. */
export const RespAuthAddOk = z
  .object({ id: NonEmptyString, kind: z.literal("auth.add.ok") })
  .strict();

/** Response to `auth.setSecret`. */
export const RespAuthSetSecretOk = z
  .object({ id: NonEmptyString, kind: z.literal("auth.setSecret.ok") })
  .strict();

/** Response to `auth.rotate`. */
export const RespAuthRotateOk = z
  .object({ id: NonEmptyString, kind: z.literal("auth.rotate.ok") })
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
    id: NonEmptyString,
    kind: z.literal("auth.remove.ok"),
    failed: z.array(z.string()),
  })
  .strict();

/** Response to `auth.update-meta`. */
export const RespAuthUpdateMetaOk = z
  .object({ id: NonEmptyString, kind: z.literal("auth.update-meta.ok") })
  .strict();

const RespAuthOAuthStartOAuth = z
  .object({
    email: z.string().optional(),
    orgName: z.string().optional(),
    planType: z.string().optional(),
  })
  .optional();

/** Response to `auth.oauth.start`. */
export const RespAuthOAuthStartOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.oauth.start.ok"),
    profileId: NonEmptyString,
    oauth: RespAuthOAuthStartOAuth,
  })
  .strict();

/** Response to `auth.oauth.refresh`. */
export const RespAuthOAuthRefreshOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.oauth.refresh.ok"),
    refreshed: z.literal(true),
    accessTokenExpiresAt: z.string().optional(),
  })
  .strict();

/** Response to `auth.oauth.detect`. */
export const RespAuthOAuthDetectOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("auth.oauth.detect.ok"),
    detected: z.boolean(),
    email: z.string().optional(),
    orgName: z.string().optional(),
    planType: z.string().optional(),
    accessTokenExpiresAt: z.string().optional(),
  })
  .strict();

/** Auth profile metadata embedded in `ReqAuthAdd.spec`. */
export type AuthProfileSpecT = z.infer<typeof AuthProfileSpec>;
/** Static type for `auth.list` requests. */
export type ReqAuthListT = z.infer<typeof ReqAuthList>;
/** Static type for `auth.get-secret-ref` requests. */
export type ReqAuthGetSecretRefT = z.infer<typeof ReqAuthGetSecretRef>;
/** Static type for `auth.add` requests (write-side). */
export type ReqAuthAddT = z.infer<typeof ReqAuthAdd>;
/** Static type for `auth.setSecret` requests (write-side). */
export type ReqAuthSetSecretT = z.infer<typeof ReqAuthSetSecret>;
/** Static type for `auth.rotate` requests (write-side). */
export type ReqAuthRotateT = z.infer<typeof ReqAuthRotate>;
/** Static type for `auth.remove` requests (write-side). */
export type ReqAuthRemoveT = z.infer<typeof ReqAuthRemove>;
/** Static type for `auth.update-meta` requests (write-side). */
export type ReqAuthUpdateMetaT = z.infer<typeof ReqAuthUpdateMeta>;
/** Static type for `auth.oauth.start` requests. */
export type ReqAuthOAuthStartT = z.infer<typeof ReqAuthOAuthStart>;
/** Static type for `auth.oauth.refresh` requests. */
export type ReqAuthOAuthRefreshT = z.infer<typeof ReqAuthOAuthRefresh>;
/** Static type for `auth.oauth.detect` requests. */
export type ReqAuthOAuthDetectT = z.infer<typeof ReqAuthOAuthDetect>;
/** Static type for `auth.list.ok` responses. */
export type RespAuthListOkT = z.infer<typeof RespAuthListOk>;
/** Static type for `auth.get-secret-ref.ok` responses. */
export type RespAuthGetSecretRefOkT = z.infer<typeof RespAuthGetSecretRefOk>;
/** Static type for `auth.add.ok` responses. */
export type RespAuthAddOkT = z.infer<typeof RespAuthAddOk>;
/** Static type for `auth.setSecret.ok` responses. */
export type RespAuthSetSecretOkT = z.infer<typeof RespAuthSetSecretOk>;
/** Static type for `auth.rotate.ok` responses. */
export type RespAuthRotateOkT = z.infer<typeof RespAuthRotateOk>;
/** Static type for `auth.remove.ok` responses. */
export type RespAuthRemoveOkT = z.infer<typeof RespAuthRemoveOk>;
/** Static type for `auth.update-meta.ok` responses. */
export type RespAuthUpdateMetaOkT = z.infer<typeof RespAuthUpdateMetaOk>;
/** Static type for `auth.oauth.start.ok` responses. */
export type RespAuthOAuthStartOkT = z.infer<typeof RespAuthOAuthStartOk>;
/** Static type for `auth.oauth.refresh.ok` responses. */
export type RespAuthOAuthRefreshOkT = z.infer<typeof RespAuthOAuthRefreshOk>;
/** Static type for `auth.oauth.detect.ok` responses. */
export type RespAuthOAuthDetectOkT = z.infer<typeof RespAuthOAuthDetectOk>;

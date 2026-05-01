import { z } from "zod";

const NonEmptyString = z.string().min(1);

/** Request the resolved effective config for a `(role, authProfileId, cwd)` triple. */
export const ReqProfileShow = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.show"),
    role: NonEmptyString,
    authProfileId: NonEmptyString,
    cwd: NonEmptyString,
  })
  .strict();

/** Request the discovered scope files visible from the given cwd. */
export const ReqProfileList = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.list"),
    cwd: NonEmptyString,
    roleFilter: NonEmptyString.optional(),
  })
  .strict();

/** Validate a draft scope document without writing it to disk. */
export const ReqProfileValidate = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.validate"),
    content: z.unknown(),
  })
  .strict();

/** Preview a draft scope document as a highest-precedence launch override. */
export const ReqProfilePreview = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.preview"),
    role: NonEmptyString,
    authProfileId: NonEmptyString,
    cwd: NonEmptyString,
    draft: z
      .object({
        path: NonEmptyString,
        content: z.unknown(),
      })
      .strict(),
  })
  .strict();

/** Save a scope document to an allowlisted path. */
export const ReqProfileSave = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.save"),
    path: NonEmptyString,
    content: z.unknown(),
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
    id: NonEmptyString,
    kind: z.literal("profile.show.ok"),
    effective: z.unknown(),
    provenance: z.unknown(),
  })
  .strict();

export const ProfileIssue = z
  .object({
    path: z.string(),
    message: NonEmptyString,
    code: NonEmptyString,
  })
  .strict();

export const ProfileScopeEntry = z
  .object({
    scope: NonEmptyString,
    role: z.string().nullable(),
    filePath: NonEmptyString,
    content: z.unknown().nullable(),
    /** Optional per-file read/parse/validation issues. Empty arrays are omitted. */
    issues: z.array(ProfileIssue).optional(),
  })
  .strict();

export const ProfilePreviewPayload = z
  .object({
    effective: z.unknown(),
    provenance: z.unknown(),
  })
  .strict();

export const ProfileDiffEntry = z
  .object({
    path: NonEmptyString,
    change: z.enum(["added", "removed", "changed"]),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .strict();

/** Response to `profile.list`. */
export const RespProfileListOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.list.ok"),
    scopes: z.array(ProfileScopeEntry),
  })
  .strict();

/** Response to `profile.validate`. */
export const RespProfileValidateOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.validate.ok"),
    issues: z.array(ProfileIssue),
  })
  .strict();

/** Response to `profile.preview`. */
export const RespProfilePreviewOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.preview.ok"),
    issues: z.array(ProfileIssue),
    current: ProfilePreviewPayload,
    preview: ProfilePreviewPayload.nullable(),
    diff: z.array(ProfileDiffEntry),
  })
  .strict();

/** Response to `profile.save`. */
export const RespProfileSaveOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("profile.save.ok"),
    saved: z.literal(true),
    path: NonEmptyString,
  })
  .strict();

/** Static type for `profile.show` requests. */
export type ReqProfileShowT = z.infer<typeof ReqProfileShow>;
/** Static type for `profile.list` requests. */
export type ReqProfileListT = z.infer<typeof ReqProfileList>;
/** Static type for `profile.validate` requests. */
export type ReqProfileValidateT = z.infer<typeof ReqProfileValidate>;
/** Static type for `profile.preview` requests. */
export type ReqProfilePreviewT = z.infer<typeof ReqProfilePreview>;
/** Static type for `profile.save` requests. */
export type ReqProfileSaveT = z.infer<typeof ReqProfileSave>;
/** Static type for `profile.show.ok` responses. */
export type RespProfileShowOkT = z.infer<typeof RespProfileShowOk>;
/** Static type for `profile.list.ok` responses. */
export type RespProfileListOkT = z.infer<typeof RespProfileListOk>;
/** Static type for `profile.validate.ok` responses. */
export type RespProfileValidateOkT = z.infer<typeof RespProfileValidateOk>;
/** Static type for `profile.preview.ok` responses. */
export type RespProfilePreviewOkT = z.infer<typeof RespProfilePreviewOk>;
/** Static type for `profile.save.ok` responses. */
export type RespProfileSaveOkT = z.infer<typeof RespProfileSaveOk>;
/** Static type for a profile validation issue. */
export type ProfileIssueT = z.infer<typeof ProfileIssue>;
/** Static type for a discovered scope entry. */
export type ProfileScopeEntryT = z.infer<typeof ProfileScopeEntry>;
/** Static type for a preview payload. */
export type ProfilePreviewPayloadT = z.infer<typeof ProfilePreviewPayload>;
/** Static type for a compact preview diff entry. */
export type ProfileDiffEntryT = z.infer<typeof ProfileDiffEntry>;

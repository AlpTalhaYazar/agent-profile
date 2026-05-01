import { z } from "zod";

const NonEmptyString = z.string().min(1);

/**
 * Fetch a secret on behalf of a spawned process.
 *
 * The daemon verifies the capability token, resolves `name` against the live
 * session's bound auth profile, and returns the value as base64. Any
 * verification failure (bad signature, expired, revoked) maps to `error.AUTH`.
 */
export const ReqSecretGet = z
  .object({
    id: NonEmptyString,
    kind: z.literal("secret.get"),
    capabilityToken: NonEmptyString,
    name: NonEmptyString,
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
    id: NonEmptyString,
    kind: z.literal("secrets.migrate"),
    dryRun: z.boolean().optional(),
    keepKeyring: z.boolean().optional(),
  })
  .strict();

/**
 * Response to `secret.get`.
 *
 * `valueB64` is the base64-encoded secret value. The daemon never returns
 * plaintext on the wire; consumers decode just-in-time.
 */
export const RespSecretGetOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("secret.get.ok"),
    valueB64: NonEmptyString,
  })
  .strict();

const SecretsMigrateError = z
  .object({
    key: z.string(),
    reason: z.string(),
  })
  .strict();

/**
 * Response to `secrets.migrate`. The four counters always sum to `scanned`
 * (`migrated + skipped + errors.length === scanned`); CLI surfaces them
 * verbatim.
 */
export const RespSecretsMigrateOk = z
  .object({
    id: NonEmptyString,
    kind: z.literal("secrets.migrate.ok"),
    scanned: z.number().int().nonnegative(),
    migrated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errors: z.array(SecretsMigrateError),
  })
  .strict();

/** Static type for `secret.get` requests (capability-token-gated). */
export type ReqSecretGetT = z.infer<typeof ReqSecretGet>;
/** Static type for `secrets.migrate` requests. */
export type ReqSecretsMigrateT = z.infer<typeof ReqSecretsMigrate>;
/** Static type for `secret.get.ok` responses. */
export type RespSecretGetOkT = z.infer<typeof RespSecretGetOk>;
/** Static type for `secrets.migrate.ok` responses. */
export type RespSecretsMigrateOkT = z.infer<typeof RespSecretsMigrateOk>;

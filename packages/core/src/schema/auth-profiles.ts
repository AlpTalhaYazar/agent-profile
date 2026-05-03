import { z } from "zod";

/**
 * The auth profiles document — stored at `~/.myclaude/config/authProfiles.yml`.
 *
 * Contains metadata only. Actual secret values are NOT stored here;
 * they are referenced via `keyring://service/account` URIs and resolved
 * at launch time by the secrets layer.
 */
export const AuthProfilesDoc = z.object({
  version: z.literal(1),
  authProfiles: z.record(
    z.string(),
    z.object({
      /** Human-readable label shown in the GUI. */
      displayName: z.string().optional(),
      anthropic: z.object({
        mode: z.enum(["apiKey", "bedrock", "vertex", "gateway", "oauth"]),
        /**
         * Keyring URI pointing to the Anthropic API key (or OAuth access token).
         * Must match `keyring://service/account` format exactly.
         */
        secretRef: z.string().regex(/^keyring:\/\//, "Must be a keyring:// URI"),
        /** OAuth-specific metadata. Present only when mode is "oauth". */
        oauth: z
          .object({
            email: z.string().optional(),
            orgName: z.string().optional(),
            planType: z.string().optional(),
            accessTokenExpiresAt: z.string().optional(),
            refreshTokenRef: z
              .string()
              .regex(/^keyring:\/\//)
              .optional(),
          })
          .optional(),
      }),
      /**
       * Map from secret name to keyring URI.
       * E.g. `"github.pat": "keyring://github/work"`.
       */
      mcpSecretRefs: z.record(z.string(), z.string()).default({}),
    })
  ),
});

/** Inferred type for the auth profiles document. */
export type AuthProfilesDocT = z.infer<typeof AuthProfilesDoc>;

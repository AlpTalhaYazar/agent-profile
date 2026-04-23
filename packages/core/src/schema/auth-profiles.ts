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
        mode: z.enum(["apiKey", "bedrock", "vertex", "gateway"]),
        /**
         * Keyring URI pointing to the Anthropic API key.
         * Must match `keyring://service/account` format exactly.
         */
        secretRef: z.string().regex(/^keyring:\/\//, "Must be a keyring:// URI"),
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

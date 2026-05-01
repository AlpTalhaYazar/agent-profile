import { z } from "zod";

export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export const NonEmptyString = z.string().min(1);

export const NonEmptyId = NonEmptyString;

export const KeyringSecretRef = z.string().regex(/^keyring:\/\//);

export const OAuthMetadata = strictObject({
  email: z.string().optional(),
  orgName: z.string().optional(),
  planType: z.string().optional(),
  accessTokenExpiresAt: z.string().optional(),
  refreshTokenRef: KeyringSecretRef.optional(),
});

export const PersonaCategory = z.enum(["agents", "skills", "slashCmds", "memory"]);

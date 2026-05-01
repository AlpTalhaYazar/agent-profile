import { refreshAccessToken, fetchClientMetadata } from "./token-client.js";

interface OAuthProfile {
  anthropic: {
    mode: string;
    secretRef: string;
    oauth?: {
      accessTokenExpiresAt?: string;
      refreshTokenRef?: string;
    };
  };
}

export async function refreshOAuthToken(args: {
  profileId: string;
  profile: OAuthProfile;
  getSecret: (key: string) => Promise<string | null>;
  storeSecret: (key: string, value: string) => Promise<void>;
  updateProfile: (profileId: string, patch: Record<string, unknown>) => Promise<void>;
}): Promise<{ refreshed: true; accessTokenExpiresAt?: string }> {
  const { profileId, profile, getSecret, storeSecret, updateProfile } = args;

  const refreshTokenRef = profile.anthropic.oauth?.refreshTokenRef;
  if (!refreshTokenRef) {
    throw new Error("No refresh token available for this profile");
  }

  const refreshToken = await getSecret(refreshTokenRef.replace("keyring://", ""));
  if (!refreshToken) {
    throw new Error("Refresh token not found in keychain");
  }

  const metadata = await fetchClientMetadata();
  const tokens = await refreshAccessToken(refreshToken, metadata.client_id);

  const accessTokenExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();

  // Store new access token
  const secretKey = profile.anthropic.secretRef.replace("keyring://", "");
  await storeSecret(secretKey, tokens.access_token);

  // Store new refresh token if rotated
  if (tokens.refresh_token) {
    await storeSecret(refreshTokenRef.replace("keyring://", ""), tokens.refresh_token);
  }

  // Update profile metadata
  await updateProfile(profileId, {
    "anthropic.oauth.accessTokenExpiresAt": accessTokenExpiresAt,
  });

  return { refreshed: true, accessTokenExpiresAt };
}

export function startTokenRefreshLoop(args: {
  getProfiles: () => Promise<Record<string, OAuthProfile>>;
  getSecret: (key: string) => Promise<string | null>;
  storeSecret: (key: string, value: string) => Promise<void>;
  updateProfile: (profileId: string, patch: Record<string, unknown>) => Promise<void>;
  intervalMs?: number;
  refreshBufferMs?: number;
}): { stop: () => void } {
  const intervalMs = args.intervalMs ?? 1_800_000; // 30 min
  const refreshBufferMs = args.refreshBufferMs ?? 600_000; // 10 min

  const timer = setInterval(async () => {
    try {
      const profiles = await args.getProfiles();
      for (const [profileId, profile] of Object.entries(profiles)) {
        if (profile.anthropic.mode !== "oauth") continue;
        const expiresAt = profile.anthropic.oauth?.accessTokenExpiresAt;
        if (!expiresAt) continue;

        const expires = new Date(expiresAt).getTime();
        const now = Date.now();
        if (expires - now > refreshBufferMs) continue;

        try {
          await refreshOAuthToken({
            profileId,
            profile,
            getSecret: args.getSecret,
            storeSecret: args.storeSecret,
            updateProfile: args.updateProfile,
          });
        } catch {
          // Individual profile refresh failures are logged but don't stop the loop
        }
      }
    } catch {
      // Loop errors are non-critical
    }
  }, intervalMs);

  timer.unref();

  return { stop: () => clearInterval(timer) };
}

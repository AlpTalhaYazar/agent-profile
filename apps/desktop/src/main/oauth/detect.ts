import type { DetectedCredentials } from "./types.js";

const CLAUDE_CODE_SERVICE = "Claude Code-credentials";

export async function detectClaudeCodeCredentials(args: {
  getSecret: (service: string, account: string) => Promise<string | null>;
  getUsername: () => string;
}): Promise<DetectedCredentials> {
  const { getSecret, getUsername } = args;

  try {
    const username = getUsername();
    const raw = await getSecret(CLAUDE_CODE_SERVICE, username);
    if (!raw) return { detected: false };

    const data = JSON.parse(raw);

    const hasAccessToken = typeof data.access_token === "string" && data.access_token.length > 0;
    if (!hasAccessToken) return { detected: false };

    return {
      detected: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? undefined,
      email: data.email ?? undefined,
      accessTokenExpiresAt: data.expires_at ?? undefined,
    };
  } catch {
    return { detected: false };
  }
}

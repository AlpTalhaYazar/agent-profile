import type { OAuthClientMetadata, OAuthTokens } from "./types.js";

const METADATA_URL = "https://claude.ai/oauth/claude-code-client-metadata";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CREATE_API_KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";
const ROLES_URL = "https://api.anthropic.com/api/oauth/claude_cli/roles";

export async function fetchClientMetadata(): Promise<OAuthClientMetadata> {
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`Failed to fetch OAuth client metadata: ${res.status}`);
  return (await res.json()) as OAuthClientMetadata;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string
): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  return (await res.json()) as OAuthTokens;
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string
): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }
  return (await res.json()) as OAuthTokens;
}

export async function createApiKey(accessToken: string): Promise<{ key: string }> {
  const res = await fetch(CREATE_API_KEY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return { key: "" };
  const data = (await res.json()) as { key?: string };
  return { key: data.key ?? "" };
}

export async function fetchRoles(
  accessToken: string
): Promise<{ roles?: string[]; org?: { name?: string }; email?: string }> {
  const res = await fetch(ROLES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return {};
  return (await res.json()) as { roles?: string[]; org?: { name?: string }; email?: string };
}

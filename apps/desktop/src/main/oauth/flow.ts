import { randomUUID } from "node:crypto";
import { shell } from "electron";
import { startCallbackServer } from "./callback-server.js";
import { generatePKCE } from "./pkce.js";
import { exchangeCodeForTokens, fetchClientMetadata, fetchRoles } from "./token-client.js";
import type { OAuthResult } from "./types.js";

const AUTHORIZE_URL = "https://platform.claude.com/oauth/authorize";

export async function runOAuthFlow(args: {
  profileId: string;
  displayName?: string;
  storeSecret: (key: string, value: string) => Promise<void>;
}): Promise<OAuthResult> {
  const { profileId, displayName, storeSecret } = args;

  // 1. Generate PKCE pair
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = randomUUID();

  // 2. Start localhost callback server
  const { port, waitForCallback, close } = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    // 3. Fetch client metadata
    const metadata = await fetchClientMetadata();

    // 4. Build authorize URL
    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", metadata.client_id);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    // 5. Open system browser
    await shell.openExternal(authorizeUrl.toString());

    // 6. Await callback
    const callbackResult = await waitForCallback();
    if (callbackResult.state !== state) {
      throw new Error("OAuth state mismatch — possible CSRF attack");
    }

    // 7. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      callbackResult.code,
      codeVerifier,
      redirectUri,
      metadata.client_id
    );

    // 8. Fetch roles/org info
    let email: string | undefined;
    let orgName: string | undefined;
    let planType: string | undefined;
    try {
      const roles = await fetchRoles(tokens.access_token);
      email = roles.email;
      orgName = roles.org?.name;
      planType = roles.roles?.[0];
    } catch {
      // Non-critical — profile still works without org info
    }

    // 9. Compute expiry
    const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // 10. Store tokens in keychain
    const secretKey = `anthropic/${profileId}`;
    await storeSecret(secretKey, tokens.access_token);

    if (tokens.refresh_token) {
      const refreshKey = `anthropic-oauth-refresh/${profileId}`;
      await storeSecret(refreshKey, tokens.refresh_token);
    }

    const result: OAuthResult = {
      profileId,
      accessToken: tokens.access_token,
      accessTokenExpiresAt,
    };
    if (tokens.refresh_token) result.refreshToken = tokens.refresh_token;
    if (email) result.email = email;
    if (orgName) result.orgName = orgName;
    if (planType) result.planType = planType;
    return result;
  } finally {
    close();
  }
}

import type { DaemonClient, RespAuthListOkT } from "@agent-profile/ipc-protocol";
import { type SafeStorageStore, parseKeyringUri, toKeyringKey } from "@agent-profile/secrets";
import { z } from "zod";
import type { OAuthMeta } from "../../shared/bridge.js";
import { CHANNELS } from "../../shared/channels.js";
import { withDaemonClient } from "../daemon/client-runner.js";
import { detectClaudeCodeCredentials } from "../oauth/detect.js";
import { runOAuthFlow } from "../oauth/flow.js";
import { fetchClientMetadata, refreshAccessToken } from "../oauth/token-client.js";
import type { DetectedCredentials, OAuthResult } from "../oauth/types.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const AuthOAuthStartPayload = z
  .object({
    profileId: z.string().min(1),
    displayName: z.string().optional(),
  })
  .strict();

const AuthOAuthRefreshPayload = z.object({ authId: z.string().min(1) }).strict();
const AuthOAuthDetectPayload = z.undefined();
const AuthOAuthAdoptPayload = AuthOAuthStartPayload;

export interface OAuthHandlerDeps {
  store: SafeStorageStore | undefined;
}

export function registerOAuthHandlers(
  context: RendererIpcBaseContext,
  deps: OAuthHandlerDeps = { store: undefined }
): void {
  registerSecureHandler({
    channel: CHANNELS.oauth.start,
    schema: AuthOAuthStartPayload,
    context,
    handle: async (parsed) => {
      const result = await runOAuthFlow({
        profileId: parsed.profileId,
        ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
        storeSecret: async () => {
          // Main persists the final profile once, after the flow returns all
          // metadata. This avoids partially writing refresh tokens as profiles.
        },
      });

      return withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        await persistOAuthProfile({
          client,
          store: deps.store,
          profileId: parsed.profileId,
          displayName: parsed.displayName,
          credentials: result,
        });
        return {
          profileId: result.profileId,
          oauth: {
            email: result.email,
            orgName: result.orgName,
            planType: result.planType,
          },
        };
      });
    },
  });

  registerSecureHandler({
    channel: CHANNELS.oauth.refresh,
    schema: AuthOAuthRefreshPayload,
    context,
    handle: (parsed) =>
      withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) =>
        refreshOAuthProfile({
          client,
          store: deps.store,
          authId: parsed.authId,
        })
      ),
  });

  registerSecureHandler({
    channel: CHANNELS.oauth.detect,
    schema: AuthOAuthDetectPayload,
    context,
    handle: () => detectClaudeCodeCredentials(),
  });

  registerSecureHandler({
    channel: CHANNELS.oauth.adopt,
    schema: AuthOAuthAdoptPayload,
    context,
    handle: async (parsed) => {
      const detected = await detectClaudeCodeCredentials();
      if (!detected.detected || !detected.accessToken) {
        throw new Error("No Claude Code credentials detected on this machine");
      }

      return withDaemonClient(context.myClaudeHome, context.clientVersion, async (client) => {
        await persistOAuthProfile({
          client,
          store: deps.store,
          profileId: parsed.profileId,
          displayName: parsed.displayName,
          credentials: detected,
        });
        return { profileId: parsed.profileId };
      });
    },
  });
}

async function persistOAuthProfile(args: {
  client: DaemonClient;
  store: SafeStorageStore | undefined;
  profileId: string;
  displayName: string | undefined;
  credentials: OAuthResult | DetectedCredentials;
}): Promise<void> {
  const { client, store, profileId, displayName, credentials } = args;
  if (!credentials.accessToken) {
    throw new Error("OAuth access token missing");
  }

  const accessTokenRef = `keyring://anthropic/${profileId}`;
  const refreshTokenRef = `keyring://anthropic-oauth-refresh/${profileId}`;
  const oauth = buildOAuthMeta(credentials, credentials.refreshToken ? refreshTokenRef : undefined);
  const anthropic: {
    mode: "oauth";
    secretRef: string;
    oauth?: OAuthMeta;
  } = {
    mode: "oauth",
    secretRef: accessTokenRef,
  };
  if (Object.keys(oauth).length > 0) anthropic.oauth = oauth;

  const spec: {
    id: string;
    displayName?: string;
    anthropic: typeof anthropic;
  } = {
    id: profileId,
    anthropic,
  };
  if (displayName) spec.displayName = displayName;

  await client.request("auth.add", {
    spec,
    anthropicSecretB64: Buffer.from(credentials.accessToken, "utf8").toString("base64"),
    force: true,
  });

  if (credentials.refreshToken) {
    await writeSecretRef(store, refreshTokenRef, credentials.refreshToken);
  }
}

async function refreshOAuthProfile(args: {
  client: DaemonClient;
  store: SafeStorageStore | undefined;
  authId: string;
}): Promise<{ refreshed: true; accessTokenExpiresAt?: string }> {
  const { client, store, authId } = args;
  const listResp = await client.request<RespAuthListOkT>("auth.list", { includeRefs: true });
  const profile = listResp.profiles.find((p) => p.id === authId);
  if (!profile) throw new Error(`Auth profile "${authId}" not found`);
  if (profile.mode !== "oauth") throw new Error(`Auth profile "${authId}" is not an OAuth profile`);

  const refreshTokenRef = profile.oauth?.refreshTokenRef;
  if (!refreshTokenRef) throw new Error("No refresh token available for this profile");
  const refreshToken = await readSecretRef(store, refreshTokenRef);
  if (!refreshToken) throw new Error("Refresh token not found in keychain");

  const metadata = await fetchClientMetadata();
  const tokens = await refreshAccessToken(refreshToken, metadata.client_id);
  const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await client.request("auth.rotate", {
    authId,
    anthropicSecretB64: Buffer.from(tokens.access_token, "utf8").toString("base64"),
  });

  if (tokens.refresh_token) {
    await writeSecretRef(store, refreshTokenRef, tokens.refresh_token);
  }

  await client.request("auth.update-meta", {
    authId,
    oauth: {
      accessTokenExpiresAt,
      refreshTokenRef,
    },
  });

  return { refreshed: true, accessTokenExpiresAt };
}

function buildOAuthMeta(
  input: Pick<OAuthMeta, "email" | "orgName" | "planType" | "accessTokenExpiresAt">,
  refreshTokenRef: string | undefined
): OAuthMeta {
  const meta: OAuthMeta = {};
  if (input.email !== undefined) meta.email = input.email;
  if (input.orgName !== undefined) meta.orgName = input.orgName;
  if (input.planType !== undefined) meta.planType = input.planType;
  if (input.accessTokenExpiresAt !== undefined) {
    meta.accessTokenExpiresAt = input.accessTokenExpiresAt;
  }
  if (refreshTokenRef !== undefined) meta.refreshTokenRef = refreshTokenRef;
  return meta;
}

async function readSecretRef(
  store: SafeStorageStore | undefined,
  ref: string
): Promise<string | null> {
  if (!store) throw new Error("OAuth secret store unavailable");
  const { service, account } = parseKeyringUri(ref);
  return store.get(toKeyringKey(service, account));
}

async function writeSecretRef(
  store: SafeStorageStore | undefined,
  ref: string,
  value: string
): Promise<void> {
  if (!store) throw new Error("OAuth secret store unavailable");
  const { service, account } = parseKeyringUri(ref);
  await store.set(toKeyringKey(service, account), value);
}

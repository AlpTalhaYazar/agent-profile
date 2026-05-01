export interface OAuthClientMetadata {
  client_id: string;
  redirect_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}

export interface OAuthResult {
  profileId: string;
  accessToken: string;
  refreshToken?: string;
  email?: string;
  orgName?: string;
  planType?: string;
  accessTokenExpiresAt: string;
}

export interface DetectedCredentials {
  detected: boolean;
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  orgName?: string;
  planType?: string;
  accessTokenExpiresAt?: string;
}

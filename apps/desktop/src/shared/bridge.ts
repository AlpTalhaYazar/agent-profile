export type AuthMode = "apiKey" | "bedrock" | "vertex" | "gateway" | "oauth";
export type SecretBackedAuthMode = Exclude<AuthMode, "oauth">;

export interface AuthAddSpec {
  id: string;
  displayName?: string;
  anthropic: {
    mode: SecretBackedAuthMode;
    secretRef: string;
  };
  mcpSecretRefs?: Record<string, string>;
}

export interface OAuthMeta {
  email?: string;
  orgName?: string;
  planType?: string;
  accessTokenExpiresAt?: string;
  refreshTokenRef?: string;
}

export interface SessionEvent {
  kind: "sessions.event";
  sessionId: string;
  event: "started" | "idle" | "exited" | "killed" | "drifted";
  exitCode?: number;
  ts: number;
}

export type SessionUpdatePayload =
  | { kind: "event"; event: SessionEvent }
  | { kind: "connection"; state: "up" | "down" };

export interface MyClaudeBridge {
  version?: () => Promise<string>;
  system: {
    version: () => Promise<string>;
    defaultCwd: () => Promise<string>;
    pickDirectory: () => Promise<string | null>;
  };
  auth: {
    list: () => Promise<unknown>;
    add: (input: { spec: AuthAddSpec; force?: boolean }) => Promise<unknown>;
    setSecret: (input: {
      profileId: string;
      name: string;
      value: string;
      register?: boolean;
    }) => Promise<unknown>;
    rotate: (input: { profileId: string; name?: string; value: string }) => Promise<unknown>;
    remove: (input: { profileId: string; yes?: boolean }) => Promise<unknown>;
    updateMeta: (input: {
      profileId: string;
      displayName?: string;
      oauth?: OAuthMeta;
    }) => Promise<unknown>;
  };
  oauth: {
    start: (input: { profileId: string; displayName?: string }) => Promise<unknown>;
    refresh: (input: { authId: string }) => Promise<unknown>;
    detect: () => Promise<unknown>;
    adopt: (input: { profileId: string; displayName?: string }) => Promise<unknown>;
  };
  profile: {
    list: (input: { cwd: string; roleFilter?: string }) => Promise<unknown>;
    show: (input: { role: string; authProfileId: string; cwd: string }) => Promise<unknown>;
    validate: (input: { content: unknown }) => Promise<unknown>;
    preview: (input: {
      role: string;
      authProfileId: string;
      cwd: string;
      draft: { path: string; content: unknown };
    }) => Promise<unknown>;
    save: (input: { path: string; content: unknown }) => Promise<unknown>;
  };
  persona: {
    render: (input: {
      role: string;
      authProfileId: string;
      cwd: string;
    }) => Promise<unknown>;
  };
  sessions: {
    list: () => Promise<unknown>;
    kill: (input: { sessionId: string; signal?: "SIGTERM" | "SIGKILL" }) => Promise<unknown>;
    relaunch: (input: { sessionId: string }) => Promise<unknown>;
    drift: (input: { sessionId: string }) => Promise<unknown>;
    onUpdate: (cb: (payload: SessionUpdatePayload) => void) => () => void;
  };
}

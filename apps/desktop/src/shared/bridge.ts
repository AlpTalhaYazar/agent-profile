import type { WorkspaceCandidate } from "@agent-profile/core";

export type AuthMode = "apiKey" | "bedrock" | "vertex" | "gateway" | "oauth";
export type SecretBackedAuthMode = Exclude<AuthMode, "oauth">;

export type WorkspaceCandidateOption = WorkspaceCandidate;

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

export interface SessionLaunchInput {
  role: string;
  authProfileId: string;
  cwd: string;
  passthroughArgs?: string[];
  bare?: boolean;
  strict?: boolean;
}

export interface SessionLaunchResult {
  sessionId: string;
}

export interface SessionsListInput {
  cwd?: string;
  includeNative?: boolean;
}

export interface SessionResumeNativeInput {
  sessionId: string;
  cwd: string;
}

export interface SessionTerminalOpenResult {
  sessionId: string;
  attached: boolean;
  buffer?: string;
  reason?: string;
}

export interface ProfileCreateScopeInput {
  location: "global" | "project";
  layerType: "shared" | "role";
  role?: string;
  cwd: string;
  force?: boolean;
}

export interface ProfileCreateScopeResult {
  created: true;
  path: string;
  scope: "global-shared" | "global-role" | "project-shared" | "project-role";
  role: string | null;
  content: unknown;
}

export interface SkillSearchInput {
  query: string;
  limit?: number;
}

export interface SkillCatalogItem {
  id: string;
  slug: string;
  name: string;
  source: string;
  description?: string;
  installUrl?: string;
  url?: string;
  installs?: number;
  duplicate?: boolean;
  auditStatus?: string;
}

export interface SkillsSearchResult {
  skills: SkillCatalogItem[];
}

export interface SkillsInstallInput {
  id: string;
  installUrl?: string;
  slug: string;
  source: string;
}

export interface SkillsInstallResult {
  installed: true;
  name: string;
  path: string;
  output?: string;
}

export type SessionTerminalEvent =
  | { kind: "data"; sessionId: string; data: string }
  | { kind: "exit"; sessionId: string; exitCode: number }
  | { kind: "error"; sessionId: string; message: string };

/**
 * Renderer-facing first-run bootstrap shape. Combines the daemon's
 * `system.bootstrap` response (`firstRun`, `profileCount`,
 * `setupCompleteMarker`) with the Main process's static identity
 * (`serverVersion`, `defaultCwd`) so the Renderer can do its initial wiring
 * in a single round-trip.
 */
export interface BootstrapResult {
  firstRun: boolean;
  profileCount: number;
  setupCompleteMarker: boolean;
  serverVersion: string;
  defaultCwd: string;
}

export interface MyClaudeBridge {
  system: {
    version: () => Promise<string>;
    defaultCwd: () => Promise<string>;
    pickDirectory: () => Promise<string | null>;
    workspaceCandidates: (input: { cwd: string }) => Promise<WorkspaceCandidateOption[]>;
    bootstrap: () => Promise<BootstrapResult>;
  };
  setup: {
    markComplete: () => Promise<void>;
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
    createScope: (input: ProfileCreateScopeInput) => Promise<ProfileCreateScopeResult>;
  };
  persona: {
    render: (input: {
      role: string;
      authProfileId: string;
      cwd: string;
    }) => Promise<unknown>;
  };
  skills: {
    search: (input: SkillSearchInput) => Promise<SkillsSearchResult>;
    detail: (input: { id: string }) => Promise<unknown>;
    audit: (input: { id: string }) => Promise<unknown>;
    listInstalled: (input?: {
      scope?: "global";
      agent?: "claude-code";
    }) => Promise<{ skills: SkillCatalogItem[] }>;
    install: (input: SkillsInstallInput) => Promise<SkillsInstallResult>;
  };
  sessions: {
    list: (input?: SessionsListInput) => Promise<unknown>;
    kill: (input: { sessionId: string; signal?: "SIGTERM" | "SIGKILL" }) => Promise<unknown>;
    relaunch: (input: { sessionId: string }) => Promise<unknown>;
    drift: (input: { sessionId: string }) => Promise<unknown>;
    launch: (input: SessionLaunchInput) => Promise<SessionLaunchResult>;
    resumeNative: (input: SessionResumeNativeInput) => Promise<SessionLaunchResult>;
    openTerminal: (input: { sessionId: string }) => Promise<SessionTerminalOpenResult>;
    writeTerminal: (input: { sessionId: string; data: string }) => Promise<void>;
    resizeTerminal: (input: { sessionId: string; cols: number; rows: number }) => Promise<void>;
    closeTerminal: (input: { sessionId: string }) => Promise<void>;
    onUpdate: (cb: (payload: SessionUpdatePayload) => void) => () => void;
    onTerminalEvent: (cb: (payload: SessionTerminalEvent) => void) => () => void;
  };
}

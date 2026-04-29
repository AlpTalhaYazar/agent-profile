type MergeMode = "replace" | "deep";

interface ScopeDocPersona {
  claudeMd?: string[];
  agents?: string[];
  skills?: string[];
  slashCmds?: string[];
  memory?: string[];
}

interface ScopeDocServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
  enabled?: boolean;
  __merge?: MergeMode;
  __extends?: string;
}

interface ScopeDocShape {
  version: 1;
  mcpServers: Record<string, ScopeDocServerEntry | null>;
  auth?: { profileId: string };
  env: Record<string, string>;
  settings: Record<string, unknown>;
  persona?: ScopeDocPersona;
  use: string[];
  disabledServers: string[];
}

interface AuthAddSpec {
  id: string;
  displayName?: string;
  anthropic: {
    mode: "apiKey" | "bedrock" | "vertex" | "gateway";
    secretRef: string;
  };
  mcpSecretRefs?: Record<string, string>;
}

interface SessionEvent {
  kind: "sessions.event";
  sessionId: string;
  event: "started" | "idle" | "exited" | "killed" | "drifted";
  exitCode?: number;
  ts: number;
}

type SessionUpdatePayload =
  | { kind: "event"; event: SessionEvent }
  | { kind: "connection"; state: "up" | "down" };

interface MyClaudeBridge {
  version?: () => Promise<string>;
  system?: {
    version: () => Promise<string>;
    defaultCwd: () => Promise<string>;
    pickDirectory: () => Promise<string | null>;
  };
  auth?: {
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
  };
  profile?: {
    list: (input: { cwd: string; roleFilter?: string }) => Promise<unknown>;
    show: (input: { role: string; authProfileId: string; cwd: string }) => Promise<unknown>;
    validate: (input: { content: ScopeDocShape }) => Promise<unknown>;
    preview: (input: {
      role: string;
      authProfileId: string;
      cwd: string;
      draft: { path: string; content: ScopeDocShape };
    }) => Promise<unknown>;
    save: (input: { path: string; content: ScopeDocShape }) => Promise<unknown>;
  };
  sessions?: {
    list: () => Promise<unknown>;
    kill: (input: { sessionId: string; signal?: "SIGTERM" | "SIGKILL" }) => Promise<unknown>;
    relaunch: (input: { sessionId: string }) => Promise<unknown>;
    drift: (input: { sessionId: string }) => Promise<unknown>;
    onUpdate: (cb: (payload: SessionUpdatePayload) => void) => () => void;
  };
  persona?: {
    render: (input: {
      role: string;
      authProfileId: string;
      cwd: string;
    }) => Promise<unknown>;
  };
}

declare global {
  interface Window {
    myclaude?: MyClaudeBridge;
  }
}

export {};

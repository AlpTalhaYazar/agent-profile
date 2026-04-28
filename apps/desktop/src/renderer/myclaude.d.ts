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

interface MyClaudeBridge {
  version?: () => Promise<string>;
  system?: {
    version: () => Promise<string>;
    defaultCwd: () => Promise<string>;
    pickDirectory: () => Promise<string | null>;
  };
  auth?: {
    list: () => Promise<unknown>;
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
}

declare global {
  interface Window {
    myclaude?: MyClaudeBridge;
  }
}

export {};

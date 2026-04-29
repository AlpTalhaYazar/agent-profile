/**
 * Shared renderer-side type definitions.
 *
 * The renderer accepts daemon responses as `unknown` and runs them through
 * the normalisers in `./normalize.ts`; these types describe the shape the
 * normalisers produce. They are intentionally narrower than the wire schema
 * so the editor can rely on populated fields without optional chaining
 * everywhere.
 */

export type MergeMode = "replace" | "deep";
export type EditorMode = "form" | "json";
export type TransportType = "stdio" | "http" | "streamable-http" | "sse";
export type ScopeKind =
  | "global-shared"
  | "global-role"
  | "project-shared"
  | "project-shared-local"
  | "project-role"
  | string;

export interface ScopeDocPersona {
  claudeMd?: string[];
  agents?: string[];
  skills?: string[];
  slashCmds?: string[];
  memory?: string[];
}

export interface ScopeDocServerEntry {
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

export interface ScopeDoc {
  version: 1;
  mcpServers: Record<string, ScopeDocServerEntry | null>;
  auth?: { profileId: string };
  env: Record<string, string>;
  settings: Record<string, unknown>;
  persona?: ScopeDocPersona;
  use: string[];
  disabledServers: string[];
}

export interface ScopeListEntry {
  scope: ScopeKind;
  role: string;
  path: string;
  content: ScopeDoc | null;
}

export interface AuthProfileOption {
  id: string;
  displayName: string;
  mode: string;
  secretCount: number;
}

export interface FieldProvenance {
  source?: string;
  chain?: string[];
}

export interface McpServerProvenance {
  source?: string;
  suppressedBy?: string;
  overriddenFields?: string[];
  chain?: Array<{ scope?: string; event?: string }>;
}

export interface Provenance {
  mcpServers: Record<string, McpServerProvenance>;
  env: Record<string, FieldProvenance>;
  settings: Record<string, FieldProvenance>;
  persona: Array<{ source?: string; files?: string[] }>;
}

export interface EffectiveConfig {
  mcpServers: Record<string, ScopeDocServerEntry>;
  env: Record<string, string>;
  settings: Record<string, unknown>;
  persona: Required<ScopeDocPersona>;
  auth?: { profileId: string };
}

export interface EffectiveState {
  effective: EffectiveConfig | null;
  provenance: Provenance | null;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: string;
}

export interface ValidationState {
  status: "idle" | "loading" | "ready" | "error";
  issues: ValidationIssue[];
  errorMessage: string | null;
}

export interface DiffItem {
  section: "mcpServers" | "env" | "settings" | "persona";
  key: string;
  change: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

export interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  effective: EffectiveConfig | null;
  diff: DiffItem[];
  errorMessage: string | null;
}

export type JsonState = { text: string; parseError: null } | { text: string; parseError: string };

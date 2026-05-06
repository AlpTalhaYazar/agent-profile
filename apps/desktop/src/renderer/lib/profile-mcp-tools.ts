import { createId, sortedUnion, stableStringify } from "./clone.js";
import { getErrorMessage } from "./normalize.js";
import type {
  ScopeDoc,
  ScopeDocPersona,
  ScopeDocServerEntry,
  ScopeListEntry,
  TransportType,
} from "./types.js";

export interface ResolveProfileMcpToolsTargetInput {
  scopeEntries: readonly ScopeListEntry[];
  selectedRole: string;
}

export interface ProfileMcpSecretRow {
  id: string;
  key: string;
  secretName: string;
}

export interface ProfileMcpToolDraft {
  id: string;
  originalName: string | null;
  name: string;
  transport: TransportType;
  commandOrUrl: string;
  argsText: string;
  envRows: ProfileMcpSecretRow[];
  headerRows: ProfileMcpSecretRow[];
  enabled: boolean;
  hiddenAdvancedFieldCount: number;
}

export interface ProfileMcpToolsDraft {
  tools: ProfileMcpToolDraft[];
}

export type ProfileMcpToolsField =
  | "target"
  | "name"
  | "transport"
  | "commandOrUrl"
  | "args"
  | "env"
  | "headers"
  | "advanced";

export interface ProfileMcpToolsValidationIssue {
  field: ProfileMcpToolsField;
  path: string;
  message: string;
  severity: "error";
}

export interface ProfileMcpToolsWritableTarget {
  status: "writable";
  role: string;
  path: string;
  content: ScopeDoc;
  message: null;
}

export interface ProfileMcpToolsUnavailableTarget {
  status: "unavailable";
  role: string | null;
  message: string;
}

export interface ProfileMcpToolsInvalidTarget {
  status: "invalid";
  role: string;
  message: string;
}

export type ProfileMcpToolsTarget =
  | ProfileMcpToolsWritableTarget
  | ProfileMcpToolsUnavailableTarget
  | ProfileMcpToolsInvalidTarget;

export interface ProfileMcpToolsResolvedTool {
  name: string;
  entry: ScopeDocServerEntry;
}

export type ProfileMcpToolsFormValidationResult =
  | { ok: true; value: ProfileMcpToolsResolvedTool[]; issues: [] }
  | { ok: false; value: ProfileMcpToolsResolvedTool[]; issues: ProfileMcpToolsValidationIssue[] };

export type ProfileMcpToolsPatchResult =
  | {
      ok: true;
      path: string;
      content: ScopeDoc;
      issues: [];
    }
  | {
      ok: false;
      path: null;
      content: null;
      issues: ProfileMcpToolsValidationIssue[];
    };

export interface ProfileMcpToolsPreviewSummaryItem {
  change: "added" | "removed" | "changed";
  name: string;
  transport: string;
  detail: string;
}

const SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SECRET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/;
const TOKEN_LIKE_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|\bsecretRef\b|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+/i;
const SUPPORTED_TRANSPORTS = new Set<TransportType>(["stdio", "http", "streamable-http", "sse"]);

export function resolveProfileMcpToolsTarget({
  scopeEntries,
  selectedRole,
}: ResolveProfileMcpToolsTargetInput): ProfileMcpToolsTarget {
  const role = normalizeRoleKey(selectedRole);
  if (!role) {
    return unavailableTarget(null, "Choose an Agent Profile before editing tools.");
  }

  let malformedProjectRole = false;
  let sawRoleLayer = false;
  for (const entry of scopeEntries) {
    if (normalizeRoleKey(entry.role) !== role) continue;
    if (!entry.scope.includes("role")) continue;
    sawRoleLayer = true;
    if (entry.scope !== "project-role") continue;
    if (entry.content) {
      return { status: "writable", role, path: entry.path, content: entry.content, message: null };
    }
    malformedProjectRole = true;
  }

  if (malformedProjectRole) {
    return {
      status: "invalid",
      role,
      message:
        "Selected Agent Profile tools could not be prepared. Refresh the profile and try again.",
    };
  }

  return unavailableTarget(
    role,
    sawRoleLayer
      ? "This Agent Profile needs a writable project layer before guided tools can be saved."
      : "Selected Agent Profile tools are unavailable. Choose another profile and try again."
  );
}

export function createProfileMcpToolsDraft(
  target: ProfileMcpToolsTarget,
  createRowId: () => string = createId
): ProfileMcpToolsDraft {
  if (target.status !== "writable") return { tools: [] };
  return {
    tools: Object.entries(target.content.mcpServers).flatMap(([name, server]) => {
      if (!server) return [];
      return [createDraftFromServer(name, server, createRowId)];
    }),
  };
}

export function createDefaultProfileMcpToolDraft(
  overrides: Partial<ProfileMcpToolDraft> = {}
): ProfileMcpToolDraft {
  return {
    id: overrides.id ?? createId(),
    originalName: overrides.originalName ?? null,
    name: overrides.name ?? "server",
    transport: overrides.transport ?? "stdio",
    commandOrUrl: overrides.commandOrUrl ?? "",
    argsText: overrides.argsText ?? "",
    envRows: overrides.envRows ?? [],
    headerRows: overrides.headerRows ?? [],
    enabled: overrides.enabled ?? true,
    hiddenAdvancedFieldCount: overrides.hiddenAdvancedFieldCount ?? 0,
  };
}

export function createGitHubProfileMcpToolDraft(
  input: {
    id?: string;
    name?: string;
    url?: string;
    secretName?: string;
  } = {}
): ProfileMcpToolDraft {
  return createDefaultProfileMcpToolDraft({
    ...(input.id !== undefined ? { id: input.id } : {}),
    name: input.name ?? "github",
    transport: "http",
    commandOrUrl: input.url ?? "https://api.githubcopilot.com/mcp/",
    headerRows: [
      {
        id: createId(),
        key: "Authorization",
        secretName: input.secretName ?? "github.pat",
      },
    ],
  });
}

export function validateProfileMcpToolsForm(input: {
  target: ProfileMcpToolsTarget;
  draft: ProfileMcpToolsDraft;
}): ProfileMcpToolsFormValidationResult {
  const issues: ProfileMcpToolsValidationIssue[] = [];
  if (input.target.status !== "writable") {
    issues.push({
      field: "target",
      path: "target",
      message: input.target.message,
      severity: "error",
    });
  }

  const values: ProfileMcpToolsResolvedTool[] = [];
  const seenNames = new Set<string>();

  for (const tool of input.draft.tools) {
    const name = tool.name.trim();
    if (!name || !SERVER_NAME_RE.test(name) || containsUnsafeDiagnosticText(name)) {
      issues.push({
        field: "name",
        path: toolPath(tool, "name"),
        message: "Use a short MCP server name with letters, numbers, dots, dashes, or underscores.",
        severity: "error",
      });
    } else if (seenNames.has(name)) {
      issues.push({
        field: "name",
        path: toolPath(tool, "name"),
        message: "Each MCP server name can only appear once.",
        severity: "error",
      });
    }
    if (name) seenNames.add(name);

    if (!SUPPORTED_TRANSPORTS.has(tool.transport)) {
      issues.push({
        field: "transport",
        path: toolPath(tool, "transport"),
        message: "Choose a supported MCP transport before preview or save.",
        severity: "error",
      });
    }

    if (tool.hiddenAdvancedFieldCount > 0) {
      issues.push({
        field: "advanced",
        path: toolPath(tool, "advanced"),
        message:
          "This MCP tool has advanced values hidden from the guided editor. Open Profile Workspace to edit it safely.",
        severity: "error",
      });
    }

    const commandOrUrl = tool.commandOrUrl.trim();
    if (tool.transport === "stdio") {
      if (!commandOrUrl) {
        issues.push({
          field: "commandOrUrl",
          path: toolPath(tool, "command"),
          message: "Stdio MCP tools need a command before preview or save.",
          severity: "error",
        });
      } else if (containsUnsafeDiagnosticText(commandOrUrl)) {
        issues.push({
          field: "commandOrUrl",
          path: toolPath(tool, "command"),
          message: "Use a command name here, not a token, keyring URI, or secret reference.",
          severity: "error",
        });
      }
    } else if (!isValidHttpUrl(commandOrUrl)) {
      issues.push({
        field: "commandOrUrl",
        path: toolPath(tool, "url"),
        message: "Remote MCP tools need a valid http or https URL before preview or save.",
        severity: "error",
      });
    }

    const args = splitArgs(tool.argsText);
    if (args.some(containsUnsafeDiagnosticText)) {
      issues.push({
        field: "args",
        path: toolPath(tool, "args"),
        message: "Move token-like arguments to logical tool secrets before saving.",
        severity: "error",
      });
    }

    const env = normalizeSecretRows(tool, "env", issues);
    const headers = normalizeSecretRows(tool, "headers", issues);
    if (name && SUPPORTED_TRANSPORTS.has(tool.transport)) {
      values.push({
        name,
        entry: buildServerEntry({ tool, commandOrUrl, args, env, headers }),
      });
    }
  }

  if (issues.length === 0) return { ok: true, value: values, issues: [] };
  return { ok: false, value: values, issues };
}

export function buildProfileMcpToolsPatch(input: {
  target: ProfileMcpToolsTarget;
  draft: ProfileMcpToolsDraft;
}): ProfileMcpToolsPatchResult {
  if (input.target.status !== "writable") {
    return {
      ok: false,
      path: null,
      content: null,
      issues: [
        { field: "target", path: "target", message: input.target.message, severity: "error" },
      ],
    };
  }

  const validation = validateProfileMcpToolsForm(input);
  if (!validation.ok) return { ok: false, path: null, content: null, issues: validation.issues };

  return {
    ok: true,
    path: input.target.path,
    content: patchScopeDoc(input.target.content, validation.value),
    issues: [],
  };
}

export function createSafeProfileMcpToolsPreviewSummary(
  before: ScopeDoc | null,
  after: ScopeDoc | null
): ProfileMcpToolsPreviewSummaryItem[] {
  if (!before || !after) return [];
  const items: ProfileMcpToolsPreviewSummaryItem[] = [];
  for (const name of sortedUnion(Object.keys(before.mcpServers), Object.keys(after.mcpServers))) {
    const beforeServer = before.mcpServers[name] ?? null;
    const afterServer = after.mcpServers[name] ?? null;
    if (!beforeServer && !afterServer) continue;
    if (stableStringify(beforeServer) === stableStringify(afterServer)) continue;
    const server = afterServer ?? beforeServer;
    items.push({
      change: !beforeServer ? "added" : !afterServer ? "removed" : "changed",
      name: safeServerName(name),
      transport: server ? inferTransport(server) : "MCP",
      detail: formatSafeToolDetail(
        !beforeServer ? "added" : !afterServer ? "removed" : "changed",
        server
      ),
    });
  }
  return items;
}

export function shouldGuardProfileMcpToolsClose(input: {
  isDirty: boolean;
  isSaving: boolean;
}): boolean {
  return input.isDirty && !input.isSaving;
}

export function formatProfileMcpToolsBridgeError(error: unknown, fallback: string): string {
  const message = getErrorMessage(error);
  if (containsUnsafeDiagnosticText(message)) return fallback;
  if (/mcp|tool|server/i.test(message))
    return "Profile Tools could not be checked. Review the fields and try again.";
  return fallback;
}

function createDraftFromServer(
  name: string,
  server: ScopeDocServerEntry,
  createRowId: () => string
): ProfileMcpToolDraft {
  const transport = inferTransport(server);
  const headerProjection = projectSecretRows(server.headers, createRowId);
  const envProjection = projectSecretRows(server.env, createRowId);
  const hiddenAdvancedFieldCount = headerProjection.hiddenCount + envProjection.hiddenCount;
  return {
    id: createRowId(),
    originalName: name,
    name: safeServerName(name),
    transport,
    commandOrUrl:
      transport === "stdio"
        ? sanitizeVisibleValue(server.command)
        : sanitizeVisibleValue(server.url),
    argsText: (server.args ?? []).filter((arg) => !containsUnsafeDiagnosticText(arg)).join("\n"),
    envRows: envProjection.rows,
    headerRows: headerProjection.rows,
    enabled: server.enabled ?? true,
    hiddenAdvancedFieldCount,
  };
}

function projectSecretRows(
  record: Record<string, string> | undefined,
  createRowId: () => string
): { rows: ProfileMcpSecretRow[]; hiddenCount: number } {
  const rows: ProfileMcpSecretRow[] = [];
  let hiddenCount = 0;
  for (const [key, value] of Object.entries(record ?? {})) {
    const secretName = extractSecretName(value);
    if (secretName) {
      rows.push({ id: createRowId(), key, secretName });
    } else if (value.trim().length > 0) {
      hiddenCount += 1;
    }
  }
  return { rows, hiddenCount };
}

function normalizeSecretRows(
  tool: ProfileMcpToolDraft,
  field: "env" | "headers",
  issues: ProfileMcpToolsValidationIssue[]
): Record<string, string> {
  const rows = field === "env" ? tool.envRows : tool.headerRows;
  const next: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    const secretName = row.secretName.trim();
    if (!key && !secretName) continue;
    if (!key || !FIELD_KEY_RE.test(key)) {
      issues.push({
        field,
        path: toolPath(tool, field),
        message:
          field === "env"
            ? "Use safe MCP environment variable names."
            : "Use safe MCP header names.",
        severity: "error",
      });
      continue;
    }
    if (seen.has(key)) {
      issues.push({
        field,
        path: toolPath(tool, field),
        message:
          field === "env"
            ? "Each MCP environment name can only appear once."
            : "Each MCP header name can only appear once.",
        severity: "error",
      });
      continue;
    }
    seen.add(key);
    if (!isSafeLogicalSecretName(secretName)) {
      issues.push({
        field,
        path: toolPath(tool, field),
        message:
          "Use a logical secret name such as github.pat instead of a raw token or keyring URI.",
        severity: "error",
      });
      continue;
    }
    next[key] =
      key.toLowerCase() === "authorization"
        ? `Bearer ${secretRef(secretName)}`
        : secretRef(secretName);
  }
  return next;
}

function buildServerEntry(input: {
  tool: ProfileMcpToolDraft;
  commandOrUrl: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
}): ScopeDocServerEntry {
  const base: ScopeDocServerEntry = {
    type: input.tool.transport,
    enabled: input.tool.enabled,
    __merge: "replace",
    ...(Object.keys(input.env).length > 0 ? { env: input.env } : {}),
  };
  if (input.tool.transport === "stdio") {
    return {
      ...base,
      command: input.commandOrUrl,
      ...(input.args.length > 0 ? { args: input.args } : { args: [] }),
    };
  }
  return {
    ...base,
    url: input.commandOrUrl,
    ...(Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
  };
}

function patchScopeDoc(current: ScopeDoc, tools: readonly ProfileMcpToolsResolvedTool[]): ScopeDoc {
  const next: ScopeDoc = {
    version: 1,
    mcpServers: Object.fromEntries(tools.map((tool) => [tool.name, cloneServerEntry(tool.entry)])),
    env: { ...current.env },
    settings: { ...current.settings },
    use: [...current.use],
    disabledServers: [...current.disabledServers],
    ...(current.profile ? { profile: { ...current.profile } } : {}),
    ...(current.auth ? { auth: { ...current.auth } } : {}),
    ...(current.persona ? { persona: clonePersona(current.persona) } : {}),
  };
  return next;
}

function cloneServerEntry(entry: ScopeDocServerEntry): ScopeDocServerEntry {
  return {
    ...entry,
    ...(entry.args ? { args: [...entry.args] } : {}),
    ...(entry.env ? { env: { ...entry.env } } : {}),
    ...(entry.headers ? { headers: { ...entry.headers } } : {}),
  };
}

function clonePersona(persona: ScopeDocPersona): ScopeDocPersona {
  return {
    ...(persona.claudeMd ? { claudeMd: [...persona.claudeMd] } : {}),
    ...(persona.agents ? { agents: [...persona.agents] } : {}),
    ...(persona.skills ? { skills: [...persona.skills] } : {}),
    ...(persona.slashCmds ? { slashCmds: [...persona.slashCmds] } : {}),
    ...(persona.memory ? { memory: [...persona.memory] } : {}),
  };
}

function splitArgs(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractSecretName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const bearer = /^Bearer\s+\$\{secret:([^}]+)\}$/i.exec(trimmed);
  const direct = /^\$\{secret:([^}]+)\}$/.exec(trimmed);
  const name = bearer?.[1]?.trim() ?? direct?.[1]?.trim() ?? null;
  return name && isSafeLogicalSecretName(name) ? name : null;
}

function isSafeLogicalSecretName(value: string): boolean {
  return (
    SECRET_NAME_RE.test(value) && !value.includes("//") && !containsUnsafeDiagnosticText(value)
  );
}

function secretRef(name: string): string {
  return `\${secret:${name}}`;
}

function inferTransport(entry: ScopeDocServerEntry): TransportType {
  if (entry.type === "http" || entry.type === "streamable-http" || entry.type === "sse")
    return entry.type;
  if (typeof entry.url === "string" && entry.url.length > 0) return "http";
  return "stdio";
}

function formatSafeToolDetail(
  change: ProfileMcpToolsPreviewSummaryItem["change"],
  server: ScopeDocServerEntry | null
): string {
  const prefix = change === "added" ? "Adds" : change === "removed" ? "Removes" : "Changes";
  if (!server) return `${prefix} tool`;
  const headerCount = Object.keys(server.headers ?? {}).length;
  const envCount = Object.keys(server.env ?? {}).length;
  const parts: string[] = [];
  if (headerCount > 0) parts.push(`${headerCount} header secret${headerCount === 1 ? "" : "s"}`);
  if (envCount > 0) parts.push(`${envCount} env secret${envCount === 1 ? "" : "s"}`);
  return parts.length > 0
    ? `${prefix} ${parts.join(" and ")}`
    : `${prefix} ${inferTransport(server)} tool`;
}

function safeServerName(value: string): string {
  if (containsUnsafeDiagnosticText(value)) return "MCP tool";
  return value.trim() || "MCP tool";
}

function sanitizeVisibleValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return containsUnsafeDiagnosticText(value) ? "" : value;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function toolPath(tool: ProfileMcpToolDraft, field: string): string {
  return `mcpServers.${safeServerName(tool.name || tool.originalName || tool.id)}.${field}`;
}

function unavailableTarget(role: string | null, message: string): ProfileMcpToolsUnavailableTarget {
  return { status: "unavailable", role, message };
}

function normalizeRoleKey(role: string): string {
  return role.trim().replace(/\s+/g, "-");
}

function containsUnsafeDiagnosticText(message: string): boolean {
  return /\.myclaude|project-role|global-role|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|oauth|authorization/i.test(
    message
  );
}

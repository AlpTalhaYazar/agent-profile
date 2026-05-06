import { atom } from "jotai";
import type { SessionLaunchInput } from "../../shared/bridge.js";
import {
  authProfilesAtom,
  cwdAtom,
  effectiveStateAtom,
  isBootstrappingAtom,
  isRefreshingAtom,
  previewStateAtom,
  scopeEntriesAtom,
  selectedAuthIdAtom,
  selectedRoleAtom,
  selectedScopePathAtom,
  validationStateAtom,
} from "./atoms.js";
import type {
  AuthProfileOption,
  EffectiveConfig,
  EffectiveState,
  PreviewState,
  ScopeListEntry,
  ValidationIssue,
  ValidationState,
} from "./types.js";

export type AgentProfileId = string;
export type AgentProfileReadinessStatus = "ready" | "blocked" | "warning" | "loading";
export type AgentProfileReadinessTone = "success" | "warning" | "danger" | "neutral";
export type AgentProfileBlockingCode =
  | "loading"
  | "missing-workspace"
  | "missing-role"
  | "missing-auth"
  | "auth-not-found";
export type AgentProfileFixTarget =
  | "workspace"
  | "identity"
  | "profile-config"
  | "tools"
  | "skills"
  | "inspect";

export interface AgentProfileBlockingReason {
  code: AgentProfileBlockingCode;
  message: string;
  fixLabel: string;
  fixTarget: AgentProfileFixTarget;
}

export interface AgentProfileWarning {
  code: "validation-issues" | "missing-tool-secrets";
  message: string;
  fixLabel: string;
  fixTarget: Extract<AgentProfileFixTarget, "profile-config" | "tools" | "skills" | "inspect">;
}

export interface AgentProfileAuthSummary {
  profileId: string | null;
  label: string;
  modeLabel: string;
  secretSummary: string;
  state: "selected" | "missing" | "unknown";
}

export interface AgentProfileWorkspaceSummary {
  cwd: string | null;
  label: string;
  detail: string;
  kind: "workspace" | "missing";
}

export interface AgentProfileToolSkillCounts {
  tools: number;
  envVars: number;
  settings: number;
  skills: number;
  agents: number;
  commands: number;
  memory: number;
  claudeMd: number;
  personaAssets: number;
  validationIssues: number;
}

export interface AgentProfileReadiness {
  status: AgentProfileReadinessStatus;
  tone: AgentProfileReadinessTone;
  label: string;
  canLaunch: boolean;
  blockingReason: AgentProfileBlockingReason | null;
  warnings: AgentProfileWarning[];
}

export interface AgentProfileLaunch {
  label: "Launch Claude";
  canLaunch: boolean;
  payload: SessionLaunchInput | null;
  disabledReason: string | null;
}

export interface AgentProfileCardProjection {
  title: string;
  eyebrow: string;
  metadata: string[];
  primaryLine: string;
}

export interface AgentProfileDetailProjection {
  scopeLayers: Array<{
    scope: string;
    role: string;
    path: string;
    present: boolean;
    issueCount: number;
  }>;
  capabilityBreakdown: {
    toolNames: string[];
    skillCount: number;
    agentCount: number;
    slashCommandCount: number;
    memoryCount: number;
    personaAssetCount: number;
  };
  issues: ValidationIssue[];
  inspectTarget: {
    profileId: AgentProfileId;
    role: string | null;
    authProfileId: string | null;
    cwd: string | null;
  };
}

export interface AgentProfileSecretStatus {
  name: string;
  state: "present" | "missing";
}

export interface AgentProfileToolCapabilityProjection {
  serverNames: string[];
  referencedSecretNames: string[];
  presentSecretNames: string[];
  missingSecretNames: string[];
  secretStatuses: AgentProfileSecretStatus[];
  validationIssueCount: number;
}

export interface AgentProfileSkillsCapabilityProjection {
  claudeMd: number;
  agents: number;
  skills: number;
  slashCommands: number;
  memory: number;
  personaAssets: number;
}

export interface AgentProfileCapabilityProjection {
  tools: AgentProfileToolCapabilityProjection;
  skills: AgentProfileSkillsCapabilityProjection;
}

export interface AgentProfileViewModel {
  id: AgentProfileId;
  name: string;
  purposeLabel: string;
  auth: AgentProfileAuthSummary;
  workspace: AgentProfileWorkspaceSummary;
  toolSkillCounts: AgentProfileToolSkillCounts;
  readiness: AgentProfileReadiness;
  launch: AgentProfileLaunch;
  card: AgentProfileCardProjection;
  details: AgentProfileDetailProjection;
  capabilities: AgentProfileCapabilityProjection;
}

export interface AgentProfileViewModelInput {
  selectedRole: string;
  selectedAuthId: string;
  cwd: string;
  authProfiles: readonly AuthProfileOption[];
  scopeEntries: readonly ScopeListEntry[];
  selectedScopePath: string | null;
  effectiveState: EffectiveState;
  previewState: PreviewState;
  validationState: ValidationState;
  isBootstrapping: boolean;
  isRefreshing: boolean;
}

export const agentProfileViewModelAtom = atom((get) =>
  deriveAgentProfileViewModel({
    selectedRole: get(selectedRoleAtom),
    selectedAuthId: get(selectedAuthIdAtom),
    cwd: get(cwdAtom),
    authProfiles: get(authProfilesAtom),
    scopeEntries: get(scopeEntriesAtom),
    selectedScopePath: get(selectedScopePathAtom),
    effectiveState: get(effectiveStateAtom),
    previewState: get(previewStateAtom),
    validationState: get(validationStateAtom),
    isBootstrapping: get(isBootstrappingAtom),
    isRefreshing: get(isRefreshingAtom),
  })
);

export function deriveAgentProfileViewModel(
  input: AgentProfileViewModelInput
): AgentProfileViewModel {
  const role = normalizeText(input.selectedRole);
  const authProfileId = normalizeText(input.selectedAuthId);
  const cwd = normalizeText(input.cwd);
  const id = createProfileId(role, authProfileId, cwd);
  const auth = deriveAuthSummary(authProfileId, input.authProfiles);
  const workspace = deriveWorkspaceSummary(cwd);
  const effective = input.previewState.effective ?? input.effectiveState.effective;
  const validationIssues = input.validationState.issues;
  const counts = deriveCounts(effective, validationIssues.length);
  const capabilities = deriveCapabilities({
    effective,
    validationIssues,
    selectedAuthSecretNames: deriveSelectedAuthSecretNames(authProfileId, input.authProfiles),
  });
  const readiness = deriveReadiness({
    role,
    auth,
    workspace,
    validationIssues,
    missingToolSecretCount: capabilities.tools.missingSecretNames.length,
    isLoading: input.isBootstrapping || input.isRefreshing,
  });
  const launch = deriveLaunch({ role, authProfileId, cwd, readiness });
  const name = deriveName(role);
  const purposeLabel = derivePurposeLabel(role);
  const card = deriveCardProjection({ name, purposeLabel, auth, workspace, counts, readiness });

  return {
    id,
    name,
    purposeLabel,
    auth,
    workspace,
    toolSkillCounts: counts,
    readiness,
    launch,
    card,
    details: deriveDetails({
      id,
      role,
      authProfileId,
      cwd,
      scopeEntries: input.scopeEntries,
      selectedScopePath: input.selectedScopePath,
      effective,
      validationIssues,
    }),
    capabilities,
  };
}

function normalizeText(value: string): string {
  return value.trim();
}

function createProfileId(role: string, authProfileId: string, cwd: string): AgentProfileId {
  const source = ["agent-profile", role, authProfileId, cwd].join("\0");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `profile-${(hash >>> 0).toString(36)}`;
}

function deriveAuthSummary(
  authProfileId: string,
  authProfiles: readonly AuthProfileOption[]
): AgentProfileAuthSummary {
  if (!authProfileId) {
    return {
      profileId: null,
      label: "No Claude identity",
      modeLabel: "Not selected",
      secretSummary: "No stored secrets",
      state: "missing",
    };
  }

  const profile = authProfiles.find((candidate) => candidate.id === authProfileId);
  if (!profile) {
    return {
      profileId: authProfileId,
      label: "Unknown Claude identity",
      modeLabel: "Unknown",
      secretSummary: "Secret status unavailable",
      state: "unknown",
    };
  }

  return {
    profileId: profile.id,
    label: profile.displayName || profile.id,
    modeLabel: humanizeMode(profile.mode),
    secretSummary: formatSecretCount(profile.secretCount),
    state: "selected",
  };
}

function deriveWorkspaceSummary(cwd: string): AgentProfileWorkspaceSummary {
  if (!cwd) {
    return {
      cwd: null,
      label: "No workspace",
      detail: "Choose a workspace",
      kind: "missing",
    };
  }

  return {
    cwd,
    label: basename(cwd),
    detail: shortenPath(cwd),
    kind: "workspace",
  };
}

function deriveCounts(
  effective: EffectiveConfig | null,
  validationIssueCount: number
): AgentProfileToolSkillCounts {
  if (!effective) {
    return {
      tools: 0,
      envVars: 0,
      settings: 0,
      skills: 0,
      agents: 0,
      commands: 0,
      memory: 0,
      claudeMd: 0,
      personaAssets: 0,
      validationIssues: validationIssueCount,
    };
  }

  const persona = effective.persona ?? {
    claudeMd: [],
    agents: [],
    skills: [],
    slashCmds: [],
    memory: [],
  };
  const claudeMd = safeArray(persona.claudeMd).length;
  const agents = safeArray(persona.agents).length;
  const skills = safeArray(persona.skills).length;
  const commands = safeArray(persona.slashCmds).length;
  const memory = safeArray(persona.memory).length;

  return {
    tools: safeRecordKeys(effective.mcpServers).length,
    envVars: safeRecordKeys(effective.env).length,
    settings: safeRecordKeys(effective.settings).length,
    skills,
    agents,
    commands,
    memory,
    claudeMd,
    personaAssets: claudeMd + agents + skills + commands + memory,
    validationIssues: validationIssueCount,
  };
}

function deriveReadiness(input: {
  role: string;
  auth: AgentProfileAuthSummary;
  workspace: AgentProfileWorkspaceSummary;
  validationIssues: readonly ValidationIssue[];
  missingToolSecretCount: number;
  isLoading: boolean;
}): AgentProfileReadiness {
  if (input.isLoading) {
    return blockedReadiness(
      {
        code: "loading",
        message: "Profile is still loading",
        fixLabel: "Wait for profile",
        fixTarget: "inspect",
      },
      "Loading",
      "neutral"
    );
  }

  if (!input.workspace.cwd) {
    return blockedReadiness(
      {
        code: "missing-workspace",
        message: "Choose a workspace to launch this profile",
        fixLabel: "Choose workspace",
        fixTarget: "workspace",
      },
      "Needs workspace"
    );
  }

  if (!input.role) {
    return blockedReadiness(
      {
        code: "missing-role",
        message: "Choose a role to launch this profile",
        fixLabel: "Choose role",
        fixTarget: "profile-config",
      },
      "Needs role"
    );
  }

  if (input.auth.state === "missing") {
    return blockedReadiness(
      {
        code: "missing-auth",
        message: "Choose a Claude identity to launch this profile",
        fixLabel: "Choose identity",
        fixTarget: "identity",
      },
      "Needs identity"
    );
  }

  if (input.auth.state === "unknown") {
    return blockedReadiness(
      {
        code: "auth-not-found",
        message: "Selected Claude identity is not available",
        fixLabel: "Review identity",
        fixTarget: "identity",
      },
      "Identity unavailable"
    );
  }

  const warnings: AgentProfileWarning[] = [];
  if (input.validationIssues.length > 0) {
    warnings.push({
      code: "validation-issues",
      message: `${input.validationIssues.length} profile issue${input.validationIssues.length === 1 ? "" : "s"} need review`,
      fixLabel: "Review details",
      fixTarget: "inspect",
    });
  }

  if (input.missingToolSecretCount > 0) {
    warnings.push({
      code: "missing-tool-secrets",
      message:
        input.missingToolSecretCount === 1
          ? "1 tool secret needs attention"
          : `${input.missingToolSecretCount} tool secrets need attention`,
      fixLabel: "Review tools",
      fixTarget: "tools",
    });
  }

  if (warnings.length > 0) {
    return {
      status: "warning",
      tone: "warning",
      label: "Needs review",
      canLaunch: true,
      blockingReason: null,
      warnings,
    };
  }

  return {
    status: "ready",
    tone: "success",
    label: "Ready",
    canLaunch: true,
    blockingReason: null,
    warnings: [],
  };
}

function blockedReadiness(
  reason: AgentProfileBlockingReason,
  label: string,
  tone: AgentProfileReadinessTone = "danger"
): AgentProfileReadiness {
  return {
    status: reason.code === "loading" ? "loading" : "blocked",
    tone,
    label,
    canLaunch: false,
    blockingReason: reason,
    warnings: [],
  };
}

function deriveLaunch(input: {
  role: string;
  authProfileId: string;
  cwd: string;
  readiness: AgentProfileReadiness;
}): AgentProfileLaunch {
  if (!input.readiness.canLaunch || !input.role || !input.authProfileId || !input.cwd) {
    return {
      label: "Launch Claude",
      canLaunch: false,
      payload: null,
      disabledReason: input.readiness.blockingReason?.message ?? "Profile is not ready to launch",
    };
  }

  return {
    label: "Launch Claude",
    canLaunch: true,
    payload: {
      role: input.role,
      authProfileId: input.authProfileId,
      cwd: input.cwd,
    },
    disabledReason: null,
  };
}

function deriveCardProjection(input: {
  name: string;
  purposeLabel: string;
  auth: AgentProfileAuthSummary;
  workspace: AgentProfileWorkspaceSummary;
  counts: AgentProfileToolSkillCounts;
  readiness: AgentProfileReadiness;
}): AgentProfileCardProjection {
  const capabilitySummary = formatCapabilitySummary(input.counts);
  const workspaceLabel =
    input.workspace.kind === "missing" ? input.workspace.label : input.workspace.label;
  return {
    title: input.name,
    eyebrow: input.purposeLabel,
    metadata: [input.auth.label, workspaceLabel, capabilitySummary],
    primaryLine:
      input.readiness.blockingReason?.message ?? `${input.auth.label} · ${input.workspace.detail}`,
  };
}

function deriveCapabilities(input: {
  effective: EffectiveConfig | null;
  validationIssues: readonly ValidationIssue[];
  selectedAuthSecretNames: readonly string[];
}): AgentProfileCapabilityProjection {
  const mcpServers = input.effective?.mcpServers ?? {};
  const persona = input.effective?.persona;
  const referencedSecretNames = extractReferencedSecretNames(mcpServers);
  const presentSecretSet = new Set(input.selectedAuthSecretNames.filter(isSafeSecretName));
  const presentSecretNames = referencedSecretNames.filter((name) => presentSecretSet.has(name));
  const missingSecretNames = referencedSecretNames.filter((name) => !presentSecretSet.has(name));
  const claudeMd = safeArray(persona?.claudeMd).length;
  const agents = safeArray(persona?.agents).length;
  const skills = safeArray(persona?.skills).length;
  const slashCommands = safeArray(persona?.slashCmds).length;
  const memory = safeArray(persona?.memory).length;

  return {
    tools: {
      serverNames: safeRecordKeys(mcpServers).sort((left, right) => left.localeCompare(right)),
      referencedSecretNames,
      presentSecretNames,
      missingSecretNames,
      secretStatuses: referencedSecretNames.map((name) => ({
        name,
        state: presentSecretSet.has(name) ? "present" : "missing",
      })),
      validationIssueCount: input.validationIssues.length,
    },
    skills: {
      claudeMd,
      agents,
      skills,
      slashCommands,
      memory,
      personaAssets: claudeMd + agents + skills + slashCommands + memory,
    },
  };
}

function deriveSelectedAuthSecretNames(
  authProfileId: string,
  authProfiles: readonly AuthProfileOption[]
): string[] {
  const profile = authProfiles.find((candidate) => candidate.id === authProfileId);
  if (!profile) return [];
  return uniqueSorted(profile.secretNames.filter(isSafeSecretName));
}

function extractReferencedSecretNames(mcpServers: EffectiveConfig["mcpServers"]): string[] {
  const names: string[] = [];
  for (const server of Object.values(mcpServers)) {
    names.push(...extractSecretNamesFromString(server.command));
    names.push(...safeArray(server.args).flatMap((value) => extractSecretNamesFromString(value)));
    names.push(...extractSecretNamesFromString(server.url));
    names.push(
      ...Object.values(server.env ?? {}).flatMap((value) => extractSecretNamesFromString(value))
    );
    names.push(
      ...Object.values(server.headers ?? {}).flatMap((value) => extractSecretNamesFromString(value))
    );
  }
  return uniqueSorted(names.filter(isSafeSecretName));
}

function extractSecretNamesFromString(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const names: string[] = [];
  const pattern = /\$\{secret:([^}]+)\}/g;
  for (const match of value.matchAll(pattern)) {
    const name = match[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

function isSafeSecretName(value: string): boolean {
  return /^[A-Za-z0-9._/-]{1,120}$/.test(value) && !value.includes("//");
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function deriveDetails(input: {
  id: AgentProfileId;
  role: string;
  authProfileId: string;
  cwd: string;
  scopeEntries: readonly ScopeListEntry[];
  selectedScopePath: string | null;
  effective: EffectiveConfig | null;
  validationIssues: readonly ValidationIssue[];
}): AgentProfileDetailProjection {
  const issuesByPath = new Map(input.validationIssues.map((issue) => [issue.path, issue]));
  const mcpServers = input.effective?.mcpServers ?? {};
  const persona = input.effective?.persona;
  const claudeMd = safeArray(persona?.claudeMd).length;
  const agents = safeArray(persona?.agents).length;
  const skills = safeArray(persona?.skills).length;
  const slashCommands = safeArray(persona?.slashCmds).length;
  const memory = safeArray(persona?.memory).length;

  return {
    scopeLayers: input.scopeEntries.map((entry) => ({
      scope: entry.scope,
      role: entry.role,
      path: entry.path,
      present: entry.content !== null,
      issueCount: issuesByPath.has(entry.path) ? 1 : 0,
    })),
    capabilityBreakdown: {
      toolNames: safeRecordKeys(mcpServers),
      skillCount: skills,
      agentCount: agents,
      slashCommandCount: slashCommands,
      memoryCount: memory,
      personaAssetCount: claudeMd + agents + skills + slashCommands + memory,
    },
    issues: [...input.validationIssues],
    inspectTarget: {
      profileId: input.id,
      role: input.role || null,
      authProfileId: input.authProfileId || null,
      cwd: input.cwd || null,
    },
  };
}

function deriveName(role: string): string {
  return role ? `${humanizeKebab(role)} Agent` : "Agent Profile";
}

function derivePurposeLabel(role: string): string {
  return role ? `${humanizeKebab(role)} Claude profile` : "Workspace Claude profile";
}

function humanizeMode(mode: string): string {
  const normalized = mode.trim().toLowerCase();
  switch (normalized) {
    case "apikey":
    case "api-key":
      return "API key";
    case "oauth":
      return "OAuth";
    case "bedrock":
      return "Bedrock";
    case "vertex":
      return "Vertex";
    case "gateway":
      return "Gateway";
    default:
      return mode || "Unknown";
  }
}

function humanizeKebab(value: string): string {
  const words = value
    .split(/[-_\s]+/g)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return "Agent";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/g, "");
  return normalized.split(/[\\/]/g).pop() || normalized || "Workspace";
}

function shortenPath(path: string): string {
  const parts = path
    .replace(/[\\/]+$/g, "")
    .split(/[\\/]/g)
    .filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join("/")}`;
}

function formatSecretCount(count: number): string {
  if (count <= 0) return "No stored secrets";
  if (count === 1) return "1 stored secret";
  return `${count} stored secrets`;
}

function formatCapabilitySummary(counts: AgentProfileToolSkillCounts): string {
  const parts: string[] = [];
  if (counts.tools > 0) parts.push(`${counts.tools} tool${counts.tools === 1 ? "" : "s"}`);
  if (counts.skills > 0) parts.push(`${counts.skills} skill${counts.skills === 1 ? "" : "s"}`);
  if (parts.length === 0) return "No tools or skills";
  return parts.join(" · ");
}

function safeArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeRecordKeys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

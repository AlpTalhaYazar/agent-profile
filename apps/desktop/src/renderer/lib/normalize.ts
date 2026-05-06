/**
 * Normalisers convert daemon responses (typed as `unknown` on the wire) into
 * the renderer-side shapes declared in `./types.ts`. They never throw — every
 * branch produces a sensible default — so the editor can render even when
 * the server returns a partially populated payload.
 */

import { sanitizeProfileLabel } from "./profile-identity.js";
import type {
  AuthProfileOption,
  EffectiveConfig,
  EffectiveState,
  FieldProvenance,
  McpServerProvenance,
  MergeMode,
  Provenance,
  ScopeDoc,
  ScopeDocPersona,
  ScopeDocProfile,
  ScopeDocServerEntry,
  ScopeListEntry,
  ValidationIssue,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function normalizeAuthProfiles(input: unknown): AuthProfileOption[] {
  const candidates = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.profiles)
      ? input.profiles
      : [];

  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = asString(candidate.id);
    if (!id) return [];
    const displayName =
      sanitizeProfileLabel(candidate.displayName) ?? sanitizeProfileLabel(id) ?? "Claude identity";
    return [
      {
        id,
        displayName,
        mode: asString(candidate.mode) ?? "unknown",
        secretCount: Array.isArray(candidate.secrets) ? candidate.secrets.length : 0,
        secretNames: normalizeSecretNames(candidate.secrets),
      },
    ];
  });
}

export function normalizeScopeList(input: unknown): ScopeListEntry[] {
  const candidates = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.entries)
      ? input.entries
      : isRecord(input) && Array.isArray(input.scopes)
        ? input.scopes
        : [];

  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const path =
      asString(candidate.path) ?? asString(candidate.filePath) ?? asString(candidate.scopePath);
    const scope = asString(candidate.scope) ?? "unknown";
    if (!path) return [];
    const contentCandidate = candidate.content ?? candidate.doc ?? candidate.scopeDoc ?? null;
    return [
      {
        path,
        scope,
        role: asString(candidate.role) ?? "—",
        content: normalizeMaybeScopeDoc(contentCandidate),
      },
    ];
  });
}

export function normalizeEffectiveState(input: unknown): EffectiveState {
  if (!input || !isRecord(input)) return { effective: null, provenance: null };
  const effectiveCandidate =
    isRecord(input.effective) || Array.isArray(input.effective) ? input.effective : input;
  const provenanceCandidate = isRecord(input.provenance) ? input.provenance : null;
  return {
    effective: normalizeEffectiveConfig(effectiveCandidate),
    provenance: normalizeProvenance(provenanceCandidate),
  };
}

export function normalizeEffectiveConfig(input: unknown): EffectiveConfig | null {
  if (!isRecord(input)) return null;
  const persona = isRecord(input.persona) ? input.persona : {};
  return {
    mcpServers: normalizeServersRecord(input.mcpServers),
    env: normalizeStringRecord(input.env),
    settings: normalizeUnknownRecord(input.settings),
    persona: {
      claudeMd: normalizeStringArray(persona.claudeMd),
      agents: normalizeStringArray(persona.agents),
      skills: normalizeStringArray(persona.skills),
      slashCmds: normalizeStringArray(persona.slashCmds),
      memory: normalizeStringArray(persona.memory),
    },
    ...(isRecord(input.auth) && typeof input.auth.profileId === "string"
      ? { auth: { profileId: input.auth.profileId } }
      : {}),
  };
}

export function normalizeProvenance(input: unknown): Provenance | null {
  if (!isRecord(input)) return null;
  return {
    mcpServers: isRecord(input.mcpServers)
      ? (input.mcpServers as Record<string, McpServerProvenance>)
      : {},
    env: isRecord(input.env) ? (input.env as Record<string, FieldProvenance>) : {},
    settings: isRecord(input.settings) ? (input.settings as Record<string, FieldProvenance>) : {},
    persona: Array.isArray(input.persona) ? (input.persona as Provenance["persona"]) : [],
  };
}

export function normalizeValidationIssues(input: unknown): ValidationIssue[] {
  if (Array.isArray(input)) {
    return input.flatMap((issue) => normalizeValidationIssue(issue));
  }

  if (isRecord(input) && Array.isArray(input.issues)) {
    return input.issues.flatMap((issue) => normalizeValidationIssue(issue));
  }

  if (isRecord(input) && typeof input.ok === "boolean") {
    return input.ok ? [] : [{ path: "document", message: "Validation failed", severity: "error" }];
  }

  if (typeof input === "string") {
    return [{ path: "document", message: input, severity: "error" }];
  }

  return [];
}

export function normalizeValidationIssue(input: unknown): ValidationIssue[] {
  if (typeof input === "string") {
    return [{ path: "document", message: input, severity: "error" }];
  }
  if (!isRecord(input)) return [];
  return [
    {
      path: asString(input.path) ?? asString(input.fieldPath) ?? "document",
      message: asString(input.message) ?? "Validation issue",
      severity: asString(input.severity) ?? "error",
    },
  ];
}

export function normalizeMaybeScopeDoc(input: unknown): ScopeDoc | null {
  if (!isRecord(input)) return null;
  return normalizeScopeDoc(input);
}

export function normalizeScopeDoc(input: unknown): ScopeDoc {
  const record = isRecord(input) ? input : {};
  // ScopeDoc schema requires version: 1 (literal); normalize unknown shapes to 1.
  const version = 1 as const;
  const persona = normalizePersona(record.persona);
  const profile = normalizeProfileMetadata(record.profile);
  return {
    version,
    ...(profile ? { profile } : {}),
    mcpServers: normalizeNullableServerRecord(record.mcpServers),
    env: normalizeStringRecord(record.env),
    settings: normalizeUnknownRecord(record.settings),
    use: normalizeStringArray(record.use),
    disabledServers: normalizeStringArray(record.disabledServers),
    ...(isRecord(record.auth) && typeof record.auth.profileId === "string"
      ? { auth: { profileId: record.auth.profileId } }
      : {}),
    ...(persona ? { persona } : {}),
  };
}

export function normalizePersona(input: unknown): ScopeDocPersona | undefined {
  if (!isRecord(input)) return undefined;
  return {
    claudeMd: normalizeStringArray(input.claudeMd),
    agents: normalizeStringArray(input.agents),
    skills: normalizeStringArray(input.skills),
    slashCmds: normalizeStringArray(input.slashCmds),
    memory: normalizeStringArray(input.memory),
  };
}

export function normalizeProfileMetadata(input: unknown): ScopeDocProfile | undefined {
  if (!isRecord(input)) return undefined;
  const displayName = normalizeDisplayText(input.displayName);
  const purpose = normalizeDisplayText(input.purpose);
  const profile: ScopeDocProfile = {};
  if (displayName) profile.displayName = displayName;
  if (purpose) profile.purpose = purpose;
  return Object.keys(profile).length > 0 ? profile : undefined;
}

export function removeAuthBinding(scopeDoc: ScopeDoc): ScopeDoc {
  const { auth: _auth, ...next } = scopeDoc;
  return next;
}

export function normalizeNullableServerRecord(
  input: unknown
): Record<string, ScopeDocServerEntry | null> {
  if (!isRecord(input)) return {};
  const next: Record<string, ScopeDocServerEntry | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) {
      next[key] = null;
      continue;
    }
    if (!isRecord(value)) continue;
    next[key] = {
      ...(typeof value.type === "string" ? { type: value.type } : {}),
      ...(typeof value.command === "string" ? { command: value.command } : {}),
      ...(Array.isArray(value.args) ? { args: normalizeStringArray(value.args) } : {}),
      ...(isRecord(value.env) ? { env: normalizeStringRecord(value.env) } : {}),
      ...(isRecord(value.headers) ? { headers: normalizeStringRecord(value.headers) } : {}),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(typeof value.__merge === "string" ? { __merge: value.__merge as MergeMode } : {}),
      ...(typeof value.__extends === "string" ? { __extends: value.__extends } : {}),
    };
  }
  return next;
}

export function normalizeServersRecord(input: unknown): Record<string, ScopeDocServerEntry> {
  const nullable = normalizeNullableServerRecord(input);
  return Object.fromEntries(
    Object.entries(nullable).flatMap(([name, value]) => (value ? [[name, value]] : []))
  );
}

export function normalizeStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string")
    : [];
}

function normalizeSecretNames(input: unknown): string[] {
  return uniqueSorted(
    normalizeStringArray(input)
      .map((name) => name.trim())
      .filter(isSafeSecretName)
  );
}

function isSafeSecretName(value: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,120}$/.test(value) &&
    !value.includes("//") &&
    !/keyring:|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|authorization|oauth|client[_-]?secret|refresh[_-]?token|access[_-]?token|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/i.test(
      value
    )
  );
}

function normalizeDisplayText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function normalizeStringRecord(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : []
    )
  );
}

export function normalizeUnknownRecord(input: unknown): Record<string, unknown> {
  return isRecord(input) ? { ...input } : {};
}

export function collectRoles(entries: ScopeListEntry[]): string[] {
  return Array.from(
    new Set(entries.map((entry) => entry.role).filter((role) => role && role !== "—"))
  ).sort();
}

export function emptyPersona(): Required<ScopeDocPersona> {
  return {
    claudeMd: [],
    agents: [],
    skills: [],
    slashCmds: [],
    memory: [],
  };
}

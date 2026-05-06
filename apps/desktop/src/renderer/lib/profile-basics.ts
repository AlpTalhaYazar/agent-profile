import { createId, flattenObject, sortedUnion, stableStringify } from "./clone.js";
import type { ProfileIdentitySelection } from "./profile-identity.js";
import { sanitizeProfileLabel } from "./profile-identity.js";
import type {
  AuthProfileOption,
  ProfileBasicsValidationIssue,
  ScopeDoc,
  ScopeDocPersona,
  ScopeDocServerEntry,
  ScopeListEntry,
} from "./types.js";

export interface ResolveProfileBasicsTargetInput {
  scopeEntries: readonly ScopeListEntry[];
  selectedRole: string;
}

export interface ProfileBasicsDraftSeed extends ProfileIdentitySelection {
  displayName?: string;
  purpose?: string;
}

export interface ProfileBasicsDraft {
  displayName: string;
  purpose: string;
  authProfileId: string;
  cwd: string;
  env: Record<string, string>;
  settingsJson: string;
}

export interface ProfileBasicsEnvRow {
  id: string;
  key: string;
  value: string;
}

export type ProfileBasicsPreviewSection = "profile" | "identity" | "environment" | "settings";

export interface ProfileBasicsPreviewSummaryItem {
  section: ProfileBasicsPreviewSection;
  key: string;
  change: "added" | "removed" | "changed";
}

export interface ProfileBasicsFormValidationInput extends ValidateProfileBasicsDraftInput {
  target: ProfileBasicsTarget;
  envRows: readonly ProfileBasicsEnvRow[];
}

export type ProfileBasicsFormValidationResult =
  | { ok: true; draft: ProfileBasicsDraft; value: ProfileBasicsResolvedDraft; issues: [] }
  | {
      ok: false;
      draft: ProfileBasicsDraft;
      value: ProfileBasicsResolvedDraft;
      issues: ProfileBasicsValidationIssue[];
    };

export interface ProfileBasicsResolvedDraft {
  displayName?: string;
  purpose?: string;
  authProfileId: string;
  cwd: string;
  env: Record<string, string>;
  settings: Record<string, unknown>;
}

export interface ProfileBasicsWritableTarget {
  status: "writable";
  role: string;
  path: string;
  content: ScopeDoc;
  message: null;
}

export interface ProfileBasicsUnavailableTarget {
  status: "unavailable";
  role: string | null;
  message: string;
}

export interface ProfileBasicsInvalidTarget {
  status: "invalid";
  role: string;
  message: string;
}

export type ProfileBasicsTarget =
  | ProfileBasicsWritableTarget
  | ProfileBasicsUnavailableTarget
  | ProfileBasicsInvalidTarget;

export type ProfileBasicsValidationResult =
  | { ok: true; value: ProfileBasicsResolvedDraft; issues: [] }
  | { ok: false; value: ProfileBasicsResolvedDraft; issues: ProfileBasicsValidationIssue[] };

export type ProfileBasicsPatchResult =
  | {
      ok: true;
      path: string;
      content: ScopeDoc;
      selection: ProfileIdentitySelection;
      issues: [];
    }
  | {
      ok: false;
      path: null;
      content: null;
      selection: null;
      issues: ProfileBasicsValidationIssue[];
    };

export interface ValidateProfileBasicsDraftInput {
  draft: ProfileBasicsDraft;
  authProfiles: readonly Pick<AuthProfileOption, "id">[];
}

export interface BuildProfileBasicsPatchInput extends ValidateProfileBasicsDraftInput {
  target: ProfileBasicsTarget;
}

const DISPLAY_NAME_MAX_LENGTH = 120;
const PURPOSE_MAX_LENGTH = 280;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,119}$/;
const TOKEN_LIKE_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|\bsecretRef\b|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+/i;

/**
 * Resolve the project-owned scope layer that guided Basics is allowed to edit.
 * The helper is pure and O(scope entries): it never asks Main to create or load
 * a layer, and it intentionally returns calm status messages for UI surfaces.
 */
export function resolveProfileBasicsTarget({
  scopeEntries,
  selectedRole,
}: ResolveProfileBasicsTargetInput): ProfileBasicsTarget {
  const role = normalizeRoleKey(selectedRole);
  if (!role) {
    return unavailableTarget(null, "Choose an Agent Profile before editing basics.");
  }

  let malformedProjectRole = false;
  let sawRoleLayer = false;

  for (const entry of scopeEntries) {
    if (normalizeRoleKey(entry.role) !== role) continue;
    if (!entry.scope.includes("role")) continue;
    sawRoleLayer = true;

    if (entry.scope !== "project-role") continue;
    if (entry.content) {
      return {
        status: "writable",
        role,
        path: entry.path,
        content: entry.content,
        message: null,
      };
    }
    malformedProjectRole = true;
  }

  if (malformedProjectRole) {
    return {
      status: "invalid",
      role,
      message:
        "Selected Agent Profile basics could not be prepared. Refresh the profile and try again.",
    };
  }

  return unavailableTarget(
    role,
    sawRoleLayer
      ? "This Agent Profile needs a writable project layer before guided basics can be saved."
      : "Selected Agent Profile basics are unavailable. Choose another profile and try again."
  );
}

export function createProfileBasicsDraft(
  target: ProfileBasicsTarget,
  seed: ProfileBasicsDraftSeed
): ProfileBasicsDraft {
  if (target.status !== "writable") {
    return {
      displayName: sanitizeProfileLabel(seed.displayName) ?? "",
      purpose: sanitizeProfileLabel(seed.purpose) ?? "",
      authProfileId: seed.authProfileId.trim(),
      cwd: seed.cwd.trim(),
      env: {},
      settingsJson: "{}",
    };
  }

  const content = target.content;
  return {
    displayName:
      sanitizeProfileLabel(content.profile?.displayName) ??
      sanitizeProfileLabel(seed.displayName) ??
      "",
    purpose:
      sanitizeProfileLabel(content.profile?.purpose) ?? sanitizeProfileLabel(seed.purpose) ?? "",
    authProfileId: sanitizeAuthProfileId(content.auth?.profileId) ?? seed.authProfileId.trim(),
    cwd: seed.cwd.trim(),
    env: { ...content.env },
    settingsJson: stringifySettings(content.settings),
  };
}

export function createProfileBasicsEnvRows(
  env: Record<string, string>,
  createRowId: () => string = createId
): ProfileBasicsEnvRow[] {
  return Object.entries(env).map(([key, value]) => ({ id: createRowId(), key, value }));
}

export function buildProfileBasicsDraftFromRows(
  draft: ProfileBasicsDraft,
  envRows: readonly ProfileBasicsEnvRow[]
): { draft: ProfileBasicsDraft; issues: ProfileBasicsValidationIssue[] } {
  const env: Record<string, string> = {};
  const issues: ProfileBasicsValidationIssue[] = [];
  const seen = new Set<string>();

  for (const row of envRows) {
    const key = row.key.trim();
    const hasVisibleInput = key.length > 0 || row.value.trim().length > 0;
    if (!hasVisibleInput) continue;

    if (!key) {
      issues.push({
        field: "env",
        path: "env",
        message: "Environment variable names can use letters, numbers, and underscores.",
        severity: "error",
      });
      continue;
    }

    if (seen.has(key)) {
      issues.push({
        field: "env",
        path: `env.${key}`,
        message: "Each environment variable name can only appear once.",
        severity: "error",
      });
      continue;
    }

    seen.add(key);
    env[key] = row.value;
  }

  return { draft: { ...draft, env }, issues };
}

export function validateProfileBasicsForm({
  target,
  draft,
  envRows,
  authProfiles,
}: ProfileBasicsFormValidationInput): ProfileBasicsFormValidationResult {
  const rowDraft = buildProfileBasicsDraftFromRows(draft, envRows);
  const targetIssues: ProfileBasicsValidationIssue[] =
    target.status === "writable"
      ? []
      : [
          {
            field: "target",
            path: "target",
            message: target.message,
            severity: "error",
          },
        ];
  const validation = validateProfileBasicsDraft({ draft: rowDraft.draft, authProfiles });
  const issues = [...targetIssues, ...rowDraft.issues, ...validation.issues];

  if (issues.length === 0 && validation.ok) {
    return { ok: true, draft: rowDraft.draft, value: validation.value, issues: [] };
  }
  return { ok: false, draft: rowDraft.draft, value: validation.value, issues };
}

export function createSafeProfileBasicsPreviewSummary(
  before: ScopeDoc | null,
  after: ScopeDoc | null
): ProfileBasicsPreviewSummaryItem[] {
  if (!before || !after) return [];

  const items: ProfileBasicsPreviewSummaryItem[] = [];
  addScalarPreviewItem(
    items,
    "profile",
    "display name",
    before.profile?.displayName,
    after.profile?.displayName
  );
  addScalarPreviewItem(
    items,
    "profile",
    "purpose",
    before.profile?.purpose,
    after.profile?.purpose
  );
  addScalarPreviewItem(
    items,
    "identity",
    "Claude identity",
    before.auth?.profileId,
    after.auth?.profileId
  );

  for (const key of sortedUnion(Object.keys(before.env), Object.keys(after.env))) {
    addScalarPreviewItem(
      items,
      "environment",
      safeSummaryKey(key, "environment variable"),
      before.env[key],
      after.env[key]
    );
  }

  const beforeSettings = flattenObject(before.settings);
  const afterSettings = flattenObject(after.settings);
  for (const key of sortedUnion(
    beforeSettings.map(([path]) => path),
    afterSettings.map(([path]) => path)
  )) {
    const beforeValue = beforeSettings.find(([path]) => path === key)?.[1];
    const afterValue = afterSettings.find(([path]) => path === key)?.[1];
    addScalarPreviewItem(
      items,
      "settings",
      safeSummaryKey(key, "advanced setting"),
      beforeValue,
      afterValue
    );
  }

  return items;
}

export function shouldGuardProfileBasicsClose(input: {
  isDirty: boolean;
  isSaving: boolean;
}): boolean {
  return input.isDirty && !input.isSaving;
}

export function validateProfileBasicsDraft({
  draft,
  authProfiles,
}: ValidateProfileBasicsDraftInput): ProfileBasicsValidationResult {
  const issues: ProfileBasicsValidationIssue[] = [];
  const displayName = normalizeDraftLabel({
    value: draft.displayName,
    field: "displayName",
    maxLength: DISPLAY_NAME_MAX_LENGTH,
    message: "Use a display name without secret references or token-like text.",
    issues,
  });
  const purpose = normalizeDraftLabel({
    value: draft.purpose,
    field: "purpose",
    maxLength: PURPOSE_MAX_LENGTH,
    message: "Use a purpose without secret references or token-like text.",
    issues,
  });
  const authProfileId = draft.authProfileId.trim();
  const cwd = draft.cwd.trim();
  const env = normalizeDraftEnv(draft.env, issues);
  const settings = parseSettingsJson(draft.settingsJson, issues);

  if (!authProfileId || !authProfiles.some((profile) => profile.id === authProfileId)) {
    issues.push({
      field: "authProfileId",
      path: "authProfileId",
      message: "Choose an available Claude identity before saving basics.",
      severity: "error",
    });
  }

  if (!cwd) {
    issues.push({
      field: "cwd",
      path: "cwd",
      message: "Choose a workspace before saving basics.",
      severity: "error",
    });
  }

  const value: ProfileBasicsResolvedDraft = {
    ...(displayName ? { displayName } : {}),
    ...(purpose ? { purpose } : {}),
    authProfileId,
    cwd,
    env,
    settings,
  };

  if (issues.length === 0) return { ok: true, value, issues: [] };
  return { ok: false, value, issues };
}

export function buildProfileBasicsPatch({
  target,
  draft,
  authProfiles,
}: BuildProfileBasicsPatchInput): ProfileBasicsPatchResult {
  if (target.status !== "writable") {
    return {
      ok: false,
      path: null,
      content: null,
      selection: null,
      issues: [
        {
          field: "target",
          path: "target",
          message: target.message,
          severity: "error",
        },
      ],
    };
  }

  const validation = validateProfileBasicsDraft({ draft, authProfiles });
  if (!validation.ok) {
    return {
      ok: false,
      path: null,
      content: null,
      selection: null,
      issues: validation.issues,
    };
  }

  const content = patchScopeDoc(target.content, validation.value);
  return {
    ok: true,
    path: target.path,
    content,
    selection: {
      role: target.role,
      authProfileId: validation.value.authProfileId,
      cwd: validation.value.cwd,
    },
    issues: [],
  };
}

function unavailableTarget(role: string | null, message: string): ProfileBasicsUnavailableTarget {
  return { status: "unavailable", role, message };
}

function normalizeDraftLabel(input: {
  value: string;
  field: "displayName" | "purpose";
  maxLength: number;
  message: string;
  issues: ProfileBasicsValidationIssue[];
}): string | undefined {
  const normalized = input.value.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  const safeLabel = sanitizeProfileLabel(normalized);
  if (!safeLabel) {
    input.issues.push({
      field: input.field,
      path: input.field,
      message: input.message,
      severity: "error",
    });
    return undefined;
  }
  return safeLabel.slice(0, input.maxLength);
}

function normalizeDraftEnv(
  env: Record<string, string>,
  issues: ProfileBasicsValidationIssue[]
): Record<string, string> {
  const next: Record<string, string> = {};
  const seen = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = rawKey.trim();
    const value = rawValue;
    if (!key || !ENV_KEY_RE.test(key)) {
      issues.push({
        field: "env",
        path: "env",
        message: "Environment variable names can use letters, numbers, and underscores.",
        severity: "error",
      });
      continue;
    }

    if (seen.has(key)) {
      issues.push({
        field: "env",
        path: `env.${key}`,
        message: "Each environment variable name can only appear once.",
        severity: "error",
      });
      continue;
    }
    seen.add(key);

    if (looksUnsafeValue(value)) {
      issues.push({
        field: "env",
        path: `env.${key}`,
        message: "Move secret-like environment values to the identity vault before saving basics.",
        severity: "error",
      });
      continue;
    }

    next[key] = value;
  }

  return next;
}

function parseSettingsJson(
  settingsJson: string,
  issues: ProfileBasicsValidationIssue[]
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = settingsJson.trim() ? JSON.parse(settingsJson) : {};
  } catch {
    issues.push({
      field: "settings",
      path: "settings",
      message: "Settings must be valid JSON.",
      severity: "error",
    });
    return {};
  }

  if (!isPlainRecord(parsed)) {
    issues.push({
      field: "settings",
      path: "settings",
      message: "Settings JSON must be an object.",
      severity: "error",
    });
    return {};
  }

  if (containsUnsafeSettingsValue(parsed)) {
    issues.push({
      field: "settings",
      path: "settings",
      message: "Move secret-like settings values to the identity vault before saving basics.",
      severity: "error",
    });
    return parsed;
  }

  return parsed;
}

function patchScopeDoc(current: ScopeDoc, draft: ProfileBasicsResolvedDraft): ScopeDoc {
  const next: ScopeDoc = {
    version: 1,
    mcpServers: cloneServerRecord(current.mcpServers),
    env: { ...draft.env },
    settings: { ...draft.settings },
    use: [...current.use],
    disabledServers: [...current.disabledServers],
    auth: { profileId: draft.authProfileId },
    ...(current.persona ? { persona: clonePersona(current.persona) } : {}),
  };

  const profile = buildProfileMetadata(draft);
  if (profile) next.profile = profile;
  return next;
}

function buildProfileMetadata(draft: ProfileBasicsResolvedDraft): ScopeDoc["profile"] | undefined {
  const profile: NonNullable<ScopeDoc["profile"]> = {};
  if (draft.displayName) profile.displayName = draft.displayName;
  if (draft.purpose) profile.purpose = draft.purpose;
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function cloneServerRecord(
  servers: Record<string, ScopeDocServerEntry | null>
): Record<string, ScopeDocServerEntry | null> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      server
        ? {
            ...server,
            ...(server.args ? { args: [...server.args] } : {}),
            ...(server.env ? { env: { ...server.env } } : {}),
            ...(server.headers ? { headers: { ...server.headers } } : {}),
          }
        : null,
    ])
  );
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

function stringifySettings(settings: Record<string, unknown>): string {
  return JSON.stringify(settings ?? {}, null, 2) ?? "{}";
}

function sanitizeAuthProfileId(value: unknown): string | null {
  const id = sanitizeProfileLabel(value);
  if (!id) return null;
  return id.includes("//") ? null : id;
}

function normalizeRoleKey(role: string): string {
  return role.trim().replace(/\s+/g, "-");
}

function looksUnsafeValue(value: unknown): boolean {
  return typeof value === "string" && TOKEN_LIKE_RE.test(value);
}

function containsUnsafeSettingsValue(value: unknown): boolean {
  if (looksUnsafeValue(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsUnsafeSettingsValue(item));
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nestedValue]) => TOKEN_LIKE_RE.test(key) || containsUnsafeSettingsValue(nestedValue)
  );
}

function addScalarPreviewItem(
  items: ProfileBasicsPreviewSummaryItem[],
  section: ProfileBasicsPreviewSection,
  key: string,
  beforeValue: unknown,
  afterValue: unknown
): void {
  if (beforeValue === undefined && afterValue === undefined) return;
  if (stableStringify(beforeValue) === stableStringify(afterValue)) return;
  items.push({
    section,
    key,
    change: beforeValue === undefined ? "added" : afterValue === undefined ? "removed" : "changed",
  });
}

function safeSummaryKey(value: string, fallback: string): string {
  if (
    TOKEN_LIKE_RE.test(value) ||
    /secret|token|authorization|api[_-]?key|keyring|bearer/i.test(value)
  ) {
    return fallback;
  }
  return value.trim() || fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

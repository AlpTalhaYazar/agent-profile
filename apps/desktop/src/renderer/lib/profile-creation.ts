import type { ProfileCreateScopeInput } from "../../shared/bridge.js";
import type { AuthProfileOption } from "./types.js";

export type ProfileCreationField = "purpose" | "role" | "workspace" | "identity";

export interface ProfileCreationDraft {
  purpose: string;
  cwd: string;
  authProfileId: string;
  /** Optional advanced override for the generated profile role slug. */
  roleSlug?: string;
}

export interface ProfileCreationValidationContext {
  existingRoles: readonly string[];
  authProfiles: readonly AuthProfileOption[];
}

export interface ProfileCreationValidationIssue {
  field: ProfileCreationField;
  message: string;
}

export interface ProfileCreationResolvedDraft {
  purpose: string;
  roleSlug: string;
  cwd: string;
  authProfileId: string;
}

export type ProfileCreationValidationResult =
  | {
      ok: true;
      value: ProfileCreationResolvedDraft;
      issues: [];
    }
  | {
      ok: false;
      value: ProfileCreationResolvedDraft;
      issues: ProfileCreationValidationIssue[];
    };

export interface ProfileCreationSelection {
  role: string;
  authProfileId: string;
  cwd: string;
}

export const PROFILE_SELECTION_STORAGE_KEY = "agent-profile.selectedProfile";

export interface ProfileSelectionRestoreInput {
  stored: ProfileCreationSelection | null;
  roles: readonly string[];
  authProfiles: readonly Pick<AuthProfileOption, "id">[];
  fallbackCwd: string;
}

const ROLE_SLUG_RE = /^[a-z0-9_-]+$/;

/**
 * Convert purpose-first user language into the role slug accepted by
 * `profileCreateScopeService`. The helper is deterministic and intentionally
 * conservative: unsupported characters become separators rather than leaking
 * raw input into a filesystem path.
 */
export function deriveProfileRoleSlug(input: string): string {
  return transliterateForSlug(input)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateProfileCreationDraft(
  draft: ProfileCreationDraft,
  context: ProfileCreationValidationContext
): ProfileCreationValidationResult {
  const purpose = normalizePurpose(draft.purpose);
  const roleSlug = resolveRoleSlug(draft);
  const cwd = draft.cwd.trim();
  const authProfileId = draft.authProfileId.trim();
  const issues: ProfileCreationValidationIssue[] = [];

  if (!purpose) {
    issues.push({
      field: "purpose",
      message: "Describe what this Agent Profile is for.",
    });
  }

  if (!roleSlug) {
    issues.push({
      field: "role",
      message: "Use letters or numbers so a safe profile role can be generated.",
    });
  } else if (!ROLE_SLUG_RE.test(roleSlug)) {
    issues.push({
      field: "role",
      message: "Profile role can use lowercase letters, numbers, hyphens, and underscores only.",
    });
  } else if (roleExists(roleSlug, context.existingRoles)) {
    issues.push({
      field: "role",
      message: `A profile role named “${roleSlug}” already exists. Choose a different purpose.`,
    });
  }

  if (!cwd) {
    issues.push({
      field: "workspace",
      message: "Choose a workspace before creating this Agent Profile.",
    });
  }

  if (!authProfileId) {
    issues.push({
      field: "identity",
      message: "Choose a Claude identity before creating this Agent Profile.",
    });
  } else if (!context.authProfiles.some((profile) => profile.id === authProfileId)) {
    issues.push({
      field: "identity",
      message: "Choose an available Claude identity before creating this Agent Profile.",
    });
  }

  const value: ProfileCreationResolvedDraft = {
    purpose,
    roleSlug,
    cwd,
    authProfileId,
  };

  if (issues.length === 0) {
    return { ok: true, value, issues: [] };
  }

  return { ok: false, value, issues };
}

export function buildProfileCreateScopePayload(
  value: ProfileCreationResolvedDraft
): ProfileCreateScopeInput {
  return {
    location: "project",
    layerType: "role",
    role: value.roleSlug,
    cwd: value.cwd,
  };
}

export function buildProfileSelection(
  value: ProfileCreationResolvedDraft
): ProfileCreationSelection {
  return {
    role: value.roleSlug,
    authProfileId: value.authProfileId,
    cwd: value.cwd,
  };
}

export function readProfileSelection(
  storage: Pick<Storage, "getItem">,
  key = PROFILE_SELECTION_STORAGE_KEY
): ProfileCreationSelection | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return normalizeProfileSelection(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeProfileSelection(
  storage: Pick<Storage, "setItem">,
  selection: ProfileCreationSelection,
  key = PROFILE_SELECTION_STORAGE_KEY
): void {
  storage.setItem(key, JSON.stringify(selection));
}

export function chooseRestoredProfileSelection({
  stored,
  roles,
  authProfiles,
  fallbackCwd,
}: ProfileSelectionRestoreInput): ProfileCreationSelection {
  const fallback: ProfileCreationSelection = {
    role: roles[0] ?? "",
    authProfileId: authProfiles[0]?.id ?? "",
    cwd: fallbackCwd,
  };

  if (!stored) return fallback;
  if (!stored.cwd) return fallback;
  if (!roleExists(stored.role, roles)) return fallback;
  if (!authProfiles.some((profile) => profile.id === stored.authProfileId)) return fallback;
  return stored;
}

function normalizeProfileSelection(input: unknown): ProfileCreationSelection | null {
  if (!isRecord(input)) return null;
  const role = typeof input.role === "string" ? input.role.trim() : "";
  const authProfileId = typeof input.authProfileId === "string" ? input.authProfileId.trim() : "";
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  if (!role || !authProfileId || !cwd) return null;
  return { role, authProfileId, cwd };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePurpose(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function resolveRoleSlug(draft: ProfileCreationDraft): string {
  const override = draft.roleSlug?.trim();
  if (override) return override.toLowerCase();
  return deriveProfileRoleSlug(draft.purpose);
}

function roleExists(roleSlug: string, existingRoles: readonly string[]): boolean {
  return existingRoles.some((role) => role.trim().toLowerCase() === roleSlug);
}

function transliterateForSlug(input: string): string {
  const replacements: Record<string, string> = {
    ç: "c",
    Ç: "c",
    ğ: "g",
    Ğ: "g",
    ı: "i",
    İ: "i",
    ö: "o",
    Ö: "o",
    ş: "s",
    Ş: "s",
    ü: "u",
    Ü: "u",
  };

  return Array.from(input, (character) => replacements[character] ?? character).join("");
}

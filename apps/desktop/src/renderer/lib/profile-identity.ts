import type { AuthProfileOption, ScopeListEntry } from "./types.js";

export type ProfileIdentityMetadataSource = "profile" | "legacy-role";
export type ProfileIdentityAuthState = "bound" | "missing" | "stale";

export interface ProfileIdentityAuthSummary {
  profileId: string | null;
  label: string;
  state: ProfileIdentityAuthState;
}

export interface ProfileIdentitySelection {
  role: string;
  authProfileId: string;
  cwd: string;
}

export interface ProfileIdentitySummary {
  id: string;
  role: string;
  displayName: string;
  purpose: string;
  metadataSource: ProfileIdentityMetadataSource;
  auth: ProfileIdentityAuthSummary;
  chips: string[];
  selection: ProfileIdentitySelection;
  scope: string;
}

export interface ProfileIdentityLibraryInput {
  scopeEntries: readonly ScopeListEntry[];
  authProfiles: readonly AuthProfileOption[];
  cwd: string;
}

const UNSAFE_LABEL_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|secret:|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/i;

/**
 * Project a scope list into safe, purpose-first Agent Profile library rows.
 *
 * The helper is pure and O(scope entries + auth profiles): callers pass the
 * scope content they already have, and this module never performs per-profile
 * `profile.show` calls.
 */
export function deriveProfileIdentityLibrary({
  scopeEntries,
  authProfiles,
  cwd,
}: ProfileIdentityLibraryInput): ProfileIdentitySummary[] {
  const authById = new Map(authProfiles.map((profile) => [profile.id, profile]));
  const roleEntries = new Map<string, ScopeListEntry[]>();
  for (const entry of scopeEntries) {
    if (!isRoleScopeEntry(entry)) continue;
    const role = normalizeRoleLabel(entry.role);
    const entries = roleEntries.get(role) ?? [];
    entries.push(entry);
    roleEntries.set(role, entries);
  }

  return Array.from(roleEntries.values()).map((entries) =>
    deriveProfileIdentity(selectIdentityEntryForRole(entries), authById, cwd)
  );
}

export function createAgentProfileId(entry: Pick<ScopeListEntry, "scope" | "role" | "path">): string {
  const roleSlug = normalizeRoleForId(entry.role);
  return `profile:${roleSlug}:${stableHash(`${entry.scope}\0${entry.role}\0${entry.path}`)}`;
}

export function deriveRoleDisplayName(role: string): string {
  if (!role.trim()) return "Untitled Agent Profile";
  const words = titleizeRole(role);
  return words ? `${words} Agent` : "Untitled Agent Profile";
}

export function deriveRolePurpose(role: string): string {
  if (!role.trim()) return "Claude profile";
  const words = titleizeRole(role);
  return words ? `${words} Claude profile` : "Claude profile";
}

export function sanitizeProfileLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (UNSAFE_LABEL_RE.test(normalized)) return null;
  return normalized;
}

function selectIdentityEntryForRole(entries: readonly ScopeListEntry[]): ScopeListEntry {
  const selected =
    entries.find((entry) => entry.scope === "project-role" && entry.content?.profile) ??
    entries.find((entry) => entry.scope === "project-role") ??
    entries.find((entry) => entry.content?.profile) ??
    entries[0];
  if (!selected) throw new Error("expected at least one role scope entry");
  return selected;
}

function deriveProfileIdentity(
  entry: ScopeListEntry,
  authById: ReadonlyMap<string, AuthProfileOption>,
  cwd: string
): ProfileIdentitySummary {
  const role = normalizeRoleLabel(entry.role);
  const profileDisplayName = sanitizeProfileLabel(entry.content?.profile?.displayName);
  const profilePurpose = sanitizeProfileLabel(entry.content?.profile?.purpose);
  const displayName = profileDisplayName ?? deriveRoleDisplayName(role);
  const purpose = profilePurpose ?? deriveRolePurpose(role);
  const metadataSource: ProfileIdentityMetadataSource =
    profileDisplayName || profilePurpose ? "profile" : "legacy-role";
  const auth = deriveAuthSummary(entry.content?.auth?.profileId, authById);

  return {
    id: createAgentProfileId(entry),
    role,
    displayName,
    purpose,
    metadataSource,
    auth,
    chips: [role, auth.label],
    selection: {
      role,
      authProfileId: auth.profileId ?? "",
      cwd,
    },
    scope: entry.scope,
  };
}

function deriveAuthSummary(
  rawProfileId: unknown,
  authById: ReadonlyMap<string, AuthProfileOption>
): ProfileIdentityAuthSummary {
  const profileId = sanitizeAuthProfileId(rawProfileId);
  if (!profileId) {
    return {
      profileId: null,
      label: "No Claude identity",
      state: "missing",
    };
  }

  const authProfile = authById.get(profileId);
  if (!authProfile) {
    return {
      profileId,
      label: "Unknown Claude identity",
      state: "stale",
    };
  }

  return {
    profileId,
    label: sanitizeProfileLabel(authProfile.displayName) ?? authProfile.id,
    state: "bound",
  };
}

function sanitizeAuthProfileId(value: unknown): string | null {
  const id = sanitizeProfileLabel(value);
  if (!id) return null;
  return id.includes("//") ? null : id;
}

function isRoleScopeEntry(entry: ScopeListEntry): boolean {
  return entry.role !== "—" && entry.role.trim().length > 0 && entry.scope.includes("role");
}

function normalizeRoleLabel(role: string): string {
  const normalized = role.trim().replace(/\s+/g, "-");
  return sanitizeProfileLabel(normalized) ?? "untitled";
}

function normalizeRoleForId(role: string): string {
  return (
    normalizeRoleLabel(role)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function titleizeRole(role: string): string {
  return normalizeRoleLabel(role)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

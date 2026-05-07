import { createId, stableStringify } from "./clone.js";
import { getErrorMessage, normalizeScopeList } from "./normalize.js";
import type {
  PersonaRenderCategory,
  PersonaRenderCollision,
  PersonaRenderMissingSource,
  ScopeDoc,
  ScopeDocPersona,
  ScopeDocServerEntry,
  ScopeListEntry,
} from "./types.js";

export const PROFILE_SKILLS_PERSONA_CATEGORIES = [
  "claudeMd",
  "agents",
  "skills",
  "slashCmds",
  "memory",
] as const;

export type ProfileSkillsPersonaCategory = (typeof PROFILE_SKILLS_PERSONA_CATEGORIES)[number];
export type ProfileSkillsPersonaField = "target" | "category" | "ref";

export interface ResolveProfileSkillsPersonaTargetInput {
  scopeEntries: readonly ScopeListEntry[];
  selectedRole: string;
}

export interface ResolveProfileSkillsPersonaListedTargetInput {
  listed: unknown;
  selectedRole: string;
}

export interface ProfileSkillsPersonaDraftRow {
  id: string;
  category: ProfileSkillsPersonaCategory;
  ref: string;
  originalRef?: string | null;
  displayLabel?: string;
}

export interface ProfileSkillsPersonaDraft {
  rows: readonly ProfileSkillsPersonaDraftRow[];
}

export interface ProfileSkillsPersonaResolvedDraft {
  claudeMd: string[];
  agents: string[];
  skills: string[];
  slashCmds: string[];
  memory: string[];
}

export interface ProfileSkillsPersonaValidationIssue {
  field: ProfileSkillsPersonaField;
  path: string;
  message: string;
  severity: "error";
}

export interface ProfileSkillsPersonaWritableTarget {
  status: "writable";
  role: string;
  path: string;
  content: ScopeDoc;
  message: null;
}

export interface ProfileSkillsPersonaUnavailableTarget {
  status: "unavailable";
  role: string | null;
  message: string;
}

export interface ProfileSkillsPersonaInvalidTarget {
  status: "invalid";
  role: string;
  message: string;
}

export type ProfileSkillsPersonaTarget =
  | ProfileSkillsPersonaWritableTarget
  | ProfileSkillsPersonaUnavailableTarget
  | ProfileSkillsPersonaInvalidTarget;

export type ProfileSkillsPersonaFormValidationResult =
  | { ok: true; value: ProfileSkillsPersonaResolvedDraft; issues: [] }
  | {
      ok: false;
      value: ProfileSkillsPersonaResolvedDraft;
      issues: ProfileSkillsPersonaValidationIssue[];
    };

export type ProfileSkillsPersonaPatchResult =
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
      issues: ProfileSkillsPersonaValidationIssue[];
    };

export interface ProfileSkillsPersonaPreviewSummaryItem {
  category: ProfileSkillsPersonaCategory;
  label: string;
  change: "added" | "removed" | "changed";
}

export interface ProfileSkillsPersonaCapabilityCount {
  category: ProfileSkillsPersonaCategory;
  count: number;
}

export interface ProfileSkillsPersonaMissingSourceSummaryItem {
  category: PersonaRenderMissingSource["category"];
  label: string;
  count: number;
  detail: string;
}

export interface ProfileSkillsPersonaCollisionSummaryItem {
  category: PersonaRenderCategory;
  label: string;
  count: number;
  detail: string;
}

const CATEGORY_LABELS: Record<ProfileSkillsPersonaCategory, string> = {
  claudeMd: "Claude memory",
  agents: "agent",
  skills: "skill",
  slashCmds: "slash command",
  memory: "memory",
};
const TOKEN_LIKE_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|\bsecretRef\b|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+/i;
const UNSAFE_DIAGNOSTIC_RE =
  /\.myclaude|project-role|global-role|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|oauth|authorization|\/Users\/|\b[A-Za-z]:\\/i;
const ABSOLUTE_PATH_RE = /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

export function resolveProfileSkillsPersonaTarget({
  scopeEntries,
  selectedRole,
}: ResolveProfileSkillsPersonaTargetInput): ProfileSkillsPersonaTarget {
  const role = normalizeRoleKey(selectedRole);
  if (!role) {
    return unavailableTarget(null, "Choose an Agent Profile before editing skills and persona.");
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
        "Selected Agent Profile skills and persona could not be prepared. Refresh the profile and try again.",
    };
  }

  return unavailableTarget(
    role,
    sawRoleLayer
      ? "This Agent Profile needs a writable project layer before guided skills and persona can be saved."
      : "Selected Agent Profile skills and persona are unavailable. Choose another profile and try again."
  );
}

export function resolveProfileSkillsPersonaTargetFromList({
  listed,
  selectedRole,
}: ResolveProfileSkillsPersonaListedTargetInput): ProfileSkillsPersonaTarget {
  return resolveProfileSkillsPersonaTarget({
    scopeEntries: normalizeScopeList(listed),
    selectedRole,
  });
}

export function createProfileSkillsPersonaDraft(
  target: ProfileSkillsPersonaTarget,
  createRowId: () => string = createId
): ProfileSkillsPersonaDraft {
  if (target.status !== "writable") return { rows: [] };

  const rows: ProfileSkillsPersonaDraftRow[] = [];
  for (const category of PROFILE_SKILLS_PERSONA_CATEGORIES) {
    const seen = new Set<string>();
    for (const rawRef of target.content.persona?.[category] ?? []) {
      const ref = rawRef.trim();
      if (!ref) continue;
      const duplicateKey = normalizeRefKey(ref);
      if (seen.has(duplicateKey)) continue;
      seen.add(duplicateKey);
      rows.push({
        id: createRowId(),
        category,
        ref,
        originalRef: ref,
        displayLabel: safeAssetLabel(category, ref),
      });
    }
  }
  return { rows };
}

export function createDefaultProfileSkillsPersonaDraftRow(
  overrides: Partial<ProfileSkillsPersonaDraftRow> = {}
): ProfileSkillsPersonaDraftRow {
  const category = overrides.category ?? "skills";
  const ref = overrides.ref ?? "";
  return {
    id: overrides.id ?? createId(),
    category,
    ref,
    originalRef: overrides.originalRef ?? null,
    displayLabel:
      overrides.displayLabel ?? (ref ? safeAssetLabel(category, ref) : CATEGORY_LABELS[category]),
  };
}

export function validateProfileSkillsPersonaForm(input: {
  target: ProfileSkillsPersonaTarget;
  draft: ProfileSkillsPersonaDraft;
}): ProfileSkillsPersonaFormValidationResult {
  const issues: ProfileSkillsPersonaValidationIssue[] = [];
  if (input.target.status !== "writable") {
    issues.push({
      field: "target",
      path: "target",
      message: input.target.message,
      severity: "error",
    });
  }

  const value = createEmptyResolvedDraft();
  const seenRefs = new Map<ProfileSkillsPersonaCategory, Set<string>>(
    PROFILE_SKILLS_PERSONA_CATEGORIES.map((category) => [category, new Set<string>()])
  );

  input.draft.rows.forEach((row, index) => {
    if (!isSupportedCategory(row.category)) {
      issues.push({
        field: "category",
        path: rowPath(row, index, "category"),
        message: "Choose a supported Skills & Persona category before saving.",
        severity: "error",
      });
      return;
    }

    const ref = row.ref.trim();
    if (!ref) {
      issues.push({
        field: "ref",
        path: rowPath(row, index, "ref"),
        message: "Choose an installed or catalog-backed persona asset before saving.",
        severity: "error",
      });
      return;
    }

    if (containsUnsafePersonaRef(ref)) {
      issues.push({
        field: "ref",
        path: rowPath(row, index, "ref"),
        message:
          "Use a persona asset reference without tokens, keyring URIs, or secret references.",
        severity: "error",
      });
      return;
    }

    if (!canSummarizeDraftRef(row.category, ref)) {
      issues.push({
        field: "ref",
        path: rowPath(row, index, "ref"),
        message: "Use a persona asset reference that can be shown by a safe name.",
        severity: "error",
      });
      return;
    }

    const duplicateKey = normalizeRefKey(ref);
    const categorySeen = seenRefs.get(row.category);
    if (categorySeen?.has(duplicateKey)) {
      issues.push({
        field: "ref",
        path: rowPath(row, index, "ref"),
        message: "Each Skills & Persona asset can only appear once per category.",
        severity: "error",
      });
      return;
    }
    categorySeen?.add(duplicateKey);
    value[row.category].push(ref);
  });

  if (issues.length === 0) return { ok: true, value, issues: [] };
  return { ok: false, value, issues };
}

export function buildProfileSkillsPersonaPatch(input: {
  target: ProfileSkillsPersonaTarget;
  draft: ProfileSkillsPersonaDraft;
}): ProfileSkillsPersonaPatchResult {
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

  const validation = validateProfileSkillsPersonaForm(input);
  if (!validation.ok) return { ok: false, path: null, content: null, issues: validation.issues };

  return {
    ok: true,
    path: input.target.path,
    content: patchScopeDoc(input.target.content, validation.value),
    issues: [],
  };
}

export function createSafeProfileSkillsPersonaPreviewSummary(
  before: ScopeDoc | null,
  after: ScopeDoc | null
): ProfileSkillsPersonaPreviewSummaryItem[] {
  if (!before || !after) return [];

  const items: ProfileSkillsPersonaPreviewSummaryItem[] = [];
  for (const category of PROFILE_SKILLS_PERSONA_CATEGORIES) {
    const beforeRefs = before.persona?.[category] ?? [];
    const afterRefs = after.persona?.[category] ?? [];
    if (stableStringify(beforeRefs) === stableStringify(afterRefs)) continue;
    const change =
      beforeRefs.length === 0 && afterRefs.length > 0
        ? "added"
        : beforeRefs.length > 0 && afterRefs.length === 0
          ? "removed"
          : "changed";
    items.push({
      category,
      label: summarizeChangedRefs(category, beforeRefs, afterRefs, change),
      change,
    });
  }
  return items;
}

export function countProfileSkillsPersonaCapabilities(
  persona: ScopeDocPersona | null | undefined
): ProfileSkillsPersonaCapabilityCount[] {
  return PROFILE_SKILLS_PERSONA_CATEGORIES.map((category) => ({
    category,
    count: persona?.[category]?.filter((ref) => ref.trim().length > 0).length ?? 0,
  }));
}

export function createSafeProfileSkillsPersonaMissingSourceSummary(
  missingSources: readonly PersonaRenderMissingSource[]
): ProfileSkillsPersonaMissingSourceSummaryItem[] {
  return missingSources.map((source) => ({
    category: source.category,
    label: safeAssetLabel(source.category, source.sourcePath, { allowAbsolute: true }),
    count: 1,
    detail: "Source could not be found.",
  }));
}

export function createSafeProfileSkillsPersonaCollisionSummary(
  collisions: readonly PersonaRenderCollision[]
): ProfileSkillsPersonaCollisionSummaryItem[] {
  return collisions.map((collision) => ({
    category: collision.category,
    label: safeAssetLabel(collision.category, collision.basename, { allowAbsolute: true }),
    count: collision.overriddenSources.length,
    detail:
      collision.overriddenSources.length === 1
        ? "One source is hidden by the selected asset."
        : `${collision.overriddenSources.length} sources are hidden by the selected asset.`,
  }));
}

export function shouldGuardProfileSkillsPersonaClose(input: {
  isDirty: boolean;
  isSaving: boolean;
}): boolean {
  return input.isDirty && !input.isSaving;
}

export function formatProfileSkillsPersonaBridgeError(error: unknown, fallback: string): string {
  const message = getErrorMessage(error);
  if (containsUnsafeDiagnosticText(message)) return fallback;
  if (/persona|skill|agent|command|memory|preview|render|collision|source/i.test(message)) {
    return "Skills & Persona could not be checked. Review the selected assets and try again.";
  }
  return fallback;
}

function patchScopeDoc(current: ScopeDoc, persona: ProfileSkillsPersonaResolvedDraft): ScopeDoc {
  return {
    version: 1,
    mcpServers: cloneServerRecord(current.mcpServers),
    env: { ...current.env },
    settings: { ...current.settings },
    use: [...current.use],
    disabledServers: [...current.disabledServers],
    ...(current.profile ? { profile: { ...current.profile } } : {}),
    ...(current.auth ? { auth: { ...current.auth } } : {}),
    persona: cloneResolvedPersona(persona),
  };
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

function cloneResolvedPersona(
  persona: ProfileSkillsPersonaResolvedDraft
): ProfileSkillsPersonaResolvedDraft {
  return {
    claudeMd: [...persona.claudeMd],
    agents: [...persona.agents],
    skills: [...persona.skills],
    slashCmds: [...persona.slashCmds],
    memory: [...persona.memory],
  };
}

function createEmptyResolvedDraft(): ProfileSkillsPersonaResolvedDraft {
  return { claudeMd: [], agents: [], skills: [], slashCmds: [], memory: [] };
}

function summarizeChangedRefs(
  category: ProfileSkillsPersonaCategory,
  beforeRefs: readonly string[],
  afterRefs: readonly string[],
  change: ProfileSkillsPersonaPreviewSummaryItem["change"]
): string {
  const beforeKeys = new Set(beforeRefs.map(normalizeRefKey));
  const afterKeys = new Set(afterRefs.map(normalizeRefKey));
  const candidates =
    change === "removed"
      ? beforeRefs.filter((ref) => !afterKeys.has(normalizeRefKey(ref)))
      : afterRefs.filter((ref) => !beforeKeys.has(normalizeRefKey(ref)));
  const [candidate] = candidates;
  if (candidate) return safeAssetLabel(category, candidate);
  const count = change === "removed" ? beforeRefs.length : afterRefs.length;
  return `${count} ${CATEGORY_LABELS[category]}${count === 1 ? "" : "s"}`;
}

function safeAssetLabel(
  category: PersonaRenderMissingSource["category"],
  value: string,
  options: { allowAbsolute?: boolean } = {}
): string {
  const label = extractSafeAssetLabel(category, value, options);
  if (label) return label;
  return category === "claudeMd" ? "Claude memory" : CATEGORY_LABELS[category];
}

function canSummarizeDraftRef(category: ProfileSkillsPersonaCategory, ref: string): boolean {
  return extractSafeAssetLabel(category, ref, { allowAbsolute: false }) !== null;
}

function extractSafeAssetLabel(
  category: PersonaRenderMissingSource["category"],
  value: string,
  options: { allowAbsolute?: boolean }
): string | null {
  const trimmed = value.trim();
  if (!trimmed || TOKEN_LIKE_RE.test(trimmed) || URI_SCHEME_RE.test(trimmed)) return null;
  if (!options.allowAbsolute && ABSOLUTE_PATH_RE.test(trimmed)) return null;

  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const last = segments.at(-1);
  if (!last) return null;
  const parent = segments.length > 1 ? segments.at(-2) : undefined;
  const candidate = category === "skills" && /^skill\.md$/i.test(last) ? (parent ?? last) : last;
  return sanitizeSummarySegment(candidate);
}

function sanitizeSummarySegment(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (TOKEN_LIKE_RE.test(normalized) || UNSAFE_DIAGNOSTIC_RE.test(normalized)) return null;
  if (/[/\\]|\0|\$\{|\bsecret\b|\btoken\b|authorization|oauth/i.test(normalized)) return null;
  return normalized.slice(0, 80);
}

function containsUnsafePersonaRef(ref: string): boolean {
  return TOKEN_LIKE_RE.test(ref);
}

function containsUnsafeDiagnosticText(message: string): boolean {
  return UNSAFE_DIAGNOSTIC_RE.test(message);
}

function normalizeRefKey(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function rowPath(row: ProfileSkillsPersonaDraftRow, index: number, field: string): string {
  const category = isSupportedCategory(row.category) ? row.category : "row";
  const id = sanitizeSummarySegment(row.id) ?? String(index + 1);
  return `persona.${category}.${id}.${field}`;
}

function unavailableTarget(
  role: string | null,
  message: string
): ProfileSkillsPersonaUnavailableTarget {
  return { status: "unavailable", role, message };
}

function normalizeRoleKey(role: string): string {
  return role.trim().replace(/\s+/g, "-");
}

function isSupportedCategory(category: unknown): category is ProfileSkillsPersonaCategory {
  return (
    typeof category === "string" && PROFILE_SKILLS_PERSONA_CATEGORIES.includes(category as never)
  );
}

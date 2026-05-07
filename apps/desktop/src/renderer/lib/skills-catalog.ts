import type {
  SkillCatalogItem,
  SkillsInstallResult,
} from "../../shared/bridge.js";

export interface SafeProfileSkillAttachment {
  label: string;
  ref: string;
  sourceLabel: string;
}

const UNSAFE_VISIBLE_TEXT_RE =
  /\.myclaude|project-role|global-role|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|oauth|authorization|\/Users\/|\/tmp\/|\b[A-Za-z]:\\|\bnpx\b/i;
const TOKEN_LIKE_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|\bsecretRef\b|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+/i;
const STACK_TRACE_RE = /(?:^|\n)\s*at\s+\S+\s+\(|(?:^|\n)\s*at\s+file:\/\//i;
const ABSOLUTE_OR_RELATIVE_PATH_RE =
  /^(?:\.?\.?\/|\/|~\/|[A-Za-z]:[\\/]|\\\\|[^\s]+\/[^\s]+)$/;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

export function normalizeAgentProfileSkillItems(
  skills: readonly SkillCatalogItem[],
): SkillCatalogItem[] {
  return skills.filter((skill) => safeSkillName(skill) !== "Skill");
}

export function createInstalledSkillAttachment(
  skill: SkillCatalogItem,
): SafeProfileSkillAttachment | null {
  const ref = safeSkillReference(skill.source);
  if (!ref) return null;
  return {
    ref,
    label: safeSkillName(skill),
    sourceLabel: "Installed skill",
  };
}

export function createCatalogInstallAttachment(
  skill: SkillCatalogItem,
  result: SkillsInstallResult,
): SafeProfileSkillAttachment | null {
  const ref = safeSkillReference(result.path);
  if (!ref) return null;
  return {
    ref,
    label: safeVisibleSegment(result.name) ?? safeSkillName(skill),
    sourceLabel: "Installed from catalog",
  };
}

export function isDuplicateSkillAttachment(
  existingRefs: readonly string[],
  candidateRef: string,
): boolean {
  const candidate = normalizeSkillReferenceKey(candidateRef);
  return existingRefs.some(
    (ref) => normalizeSkillReferenceKey(ref) === candidate,
  );
}

export function normalizeSkillReferenceKey(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

export function safeSkillName(
  skill: Pick<SkillCatalogItem, "name" | "slug">,
): string {
  return (
    safeVisibleSegment(skill.name) ?? safeVisibleSegment(skill.slug) ?? "Skill"
  );
}

export function safeSkillDescription(value: string | undefined): string | null {
  if (!value) return null;
  return safeVisibleSegment(value);
}

export function sanitizeSkillBridgeError(
  error: unknown,
  fallback: string,
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    !message ||
    UNSAFE_VISIBLE_TEXT_RE.test(message) ||
    STACK_TRACE_RE.test(message)
  ) {
    return fallback;
  }
  if (/timeout|timed out/i.test(message))
    return "Skill operation timed out. Try again later.";
  if (/duplicate|already installed|already exists/i.test(message)) {
    return "That skill is already installed. Attach it from installed skills.";
  }
  if (/skill|catalog|install|search|network|request/i.test(message))
    return message.slice(0, 160);
  return fallback;
}

export function safeVisibleSegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || UNSAFE_VISIBLE_TEXT_RE.test(normalized)) return null;
  if (/\0|\$\{|\bsecret\b|\btoken\b|authorization|oauth/i.test(normalized))
    return null;
  return normalized.slice(0, 80);
}

function safeSkillReference(value: string): string | null {
  const ref = value.trim();
  if (
    !ref ||
    TOKEN_LIKE_RE.test(ref) ||
    URI_SCHEME_RE.test(ref) ||
    hasControlCharacter(ref)
  ) {
    return null;
  }
  if (!ABSOLUTE_OR_RELATIVE_PATH_RE.test(ref)) return null;
  return ref;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

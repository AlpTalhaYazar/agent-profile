import {
  type EffectiveSessionConfig,
  findProjectChain,
  resolve as coreResolve,
} from "@agent-profile/core";
import { type PersonaRenderResult, renderPersonaInMemory } from "@agent-profile/persona-deployer";
import { join, resolve } from "node:path";
import { globalConfigDirFor, globalFragmentsDirFor } from "../paths.js";
import {
  type ProfileIssue,
  resolveCurrentProfile,
  validateScopeContent,
} from "../profile/shared.js";

const PERSONA_PREVIEW_CATEGORIES = ["claudeMd", "agents", "skills", "slashCmds", "memory"] as const;
const PERSONA_PREVIEW_FILE_CATEGORIES = ["agents", "skills", "slashCmds", "memory"] as const;
const MAX_SAFE_PREVIEW_ITEMS = 50;
const PREVIEW_FAILURE_MESSAGE =
  "Skills & Persona preview could not be prepared. Review the selected assets and try again.";
const INVALID_DRAFT_MESSAGE =
  "Skills & Persona draft could not be previewed. Review the selected assets and try again.";
const TOKEN_LIKE_RE =
  /keyring:\/\/|\$\{secret:|\$\{env:|\bsecretRef\b|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+/i;
const UNSAFE_SUMMARY_RE =
  /\.myclaude|project-role|global-role|launch-overrides|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|oauth|authorization|\/Users\/|\b[A-Za-z]:\\/i;

export type PersonaPreviewCategory = (typeof PERSONA_PREVIEW_CATEGORIES)[number];
export type PersonaPreviewFileCategory = (typeof PERSONA_PREVIEW_FILE_CATEGORIES)[number];

export interface PersonaPreviewInput {
  home: string;
  role: string;
  authProfileId?: string;
  cwd: string;
  draft: {
    path: string;
    content: unknown;
  };
}

export interface PersonaPreviewCategoryCount {
  category: PersonaPreviewCategory;
  count: number;
}

export interface PersonaPreviewBasename {
  category: PersonaPreviewCategory;
  basename: string;
}

export interface PersonaPreviewMissingSourceWarning {
  category: PersonaPreviewCategory;
  basename: string;
  count: number;
}

export interface PersonaPreviewCollisionWarning {
  category: PersonaPreviewFileCategory;
  basename: string;
  hiddenCount: number;
}

export interface PersonaPreviewMetrics {
  claudeMdSectionCount: number;
  claudeMdCharacterCount: number;
  fileCount: number;
  fileCharacterCount: number;
  totalCharacterCount: number;
  truncatedItemCount: number;
}

export interface PersonaPreviewProjection {
  categoryCounts: PersonaPreviewCategoryCount[];
  basenames: PersonaPreviewBasename[];
  missingSources: PersonaPreviewMissingSourceWarning[];
  collisions: PersonaPreviewCollisionWarning[];
  metrics: PersonaPreviewMetrics;
}

export interface PersonaPreviewFailure {
  code: "invalid-draft" | "preview-failed";
  message: string;
  retryable: boolean;
}

export interface PersonaPreviewResult {
  issues: ProfileIssue[];
  preview: PersonaPreviewProjection | null;
  failure: PersonaPreviewFailure | null;
}

export async function personaPreviewService(
  input: PersonaPreviewInput
): Promise<PersonaPreviewResult> {
  const { home, role, authProfileId, cwd, draft } = input;

  let currentResolved: EffectiveSessionConfig;
  try {
    // Mirror profile.preview's current-profile resolution before applying the
    // draft. The result is never exposed; it anchors draft replacement against
    // the selected saved scope instead of leaking raw provenance to callers.
    currentResolved = resolveCurrentProfile({
      home,
      role,
      cwd,
      ...(authProfileId !== undefined ? { authProfileId } : {}),
    });
  } catch {
    return previewFailure("preview-failed", PREVIEW_FAILURE_MESSAGE);
  }

  const parsedDraft = validateScopeContent(draft.content);
  if (!parsedDraft.doc) {
    return {
      issues: parsedDraft.issues,
      preview: null,
      failure: {
        code: "invalid-draft",
        message: INVALID_DRAFT_MESSAGE,
        retryable: true,
      },
    };
  }

  try {
    const resolveInput: Parameters<typeof coreResolve>[0] = {
      role,
      cwd,
      launchOverrides: parsedDraft.doc,
      globalConfigDir: globalConfigDirFor(home),
      fragmentDirs: [globalFragmentsDirFor(home)],
    };
    if (authProfileId !== undefined) resolveInput.authProfileId = authProfileId;

    const previewResolved = coreResolve(resolveInput);
    const draftScopeName = scopeNameForDraftPath({ home, role, cwd, draftPath: draft.path });
    const renderInput = draftScopeName
      ? buildDraftReplacementRenderInput(currentResolved, previewResolved, draftScopeName)
      : {
          effective: previewResolved.effective.persona,
          provenanceMap: buildPersonaProvenanceMap(previewResolved),
        };
    const renderResult = await renderPersonaInMemory({
      ...renderInput,
      onMissingSource: "skip",
    });

    return {
      issues: [],
      preview: projectSafePersonaPreview(renderResult),
      failure: null,
    };
  } catch {
    return previewFailure("preview-failed", PREVIEW_FAILURE_MESSAGE);
  }
}

function previewFailure(
  code: PersonaPreviewFailure["code"],
  message: string
): PersonaPreviewResult {
  return {
    issues: [],
    preview: null,
    failure: {
      code,
      message,
      retryable: true,
    },
  };
}

function buildPersonaProvenanceMap(resolved: EffectiveSessionConfig): Record<string, string> {
  const provenanceMap: Record<string, string> = {};
  for (const entry of resolved.provenance.persona) {
    for (const filePath of entry.files) {
      provenanceMap[filePath] = entry.source;
    }
  }
  return provenanceMap;
}

function buildDraftReplacementRenderInput(
  currentResolved: EffectiveSessionConfig,
  previewResolved: EffectiveSessionConfig,
  draftScopeName: string
): {
  effective: EffectiveSessionConfig["effective"]["persona"];
  provenanceMap: Record<string, string>;
} {
  const replacedFiles = filesForProvenanceSource(currentResolved, draftScopeName);
  const draftFiles = filesForProvenanceSource(previewResolved, "launch-overrides");
  const provenanceMap = buildPersonaProvenanceMap(currentResolved);

  for (const filePath of replacedFiles) {
    delete provenanceMap[filePath];
  }
  for (const filePath of draftFiles) {
    provenanceMap[filePath] = "draft";
  }

  return {
    effective: {
      claudeMd: replaceCategoryRefs(
        currentResolved.effective.persona.claudeMd,
        previewResolved.effective.persona.claudeMd,
        replacedFiles,
        draftFiles
      ),
      agents: replaceCategoryRefs(
        currentResolved.effective.persona.agents,
        previewResolved.effective.persona.agents,
        replacedFiles,
        draftFiles
      ),
      skills: replaceCategoryRefs(
        currentResolved.effective.persona.skills,
        previewResolved.effective.persona.skills,
        replacedFiles,
        draftFiles
      ),
      slashCmds: replaceCategoryRefs(
        currentResolved.effective.persona.slashCmds,
        previewResolved.effective.persona.slashCmds,
        replacedFiles,
        draftFiles
      ),
      memory: replaceCategoryRefs(
        currentResolved.effective.persona.memory,
        previewResolved.effective.persona.memory,
        replacedFiles,
        draftFiles
      ),
    },
    provenanceMap,
  };
}

function filesForProvenanceSource(
  resolved: EffectiveSessionConfig,
  sourceName: string
): Set<string> {
  const files = new Set<string>();
  for (const entry of resolved.provenance.persona) {
    if (entry.source !== sourceName) continue;
    for (const filePath of entry.files) files.add(filePath);
  }
  return files;
}

function replaceCategoryRefs(
  currentRefs: readonly string[],
  previewRefs: readonly string[],
  replacedFiles: ReadonlySet<string>,
  draftFiles: ReadonlySet<string>
): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const ref of currentRefs) {
    if (replacedFiles.has(ref) || seen.has(ref)) continue;
    output.push(ref);
    seen.add(ref);
  }
  for (const ref of previewRefs) {
    if (!draftFiles.has(ref) || seen.has(ref)) continue;
    output.push(ref);
    seen.add(ref);
  }
  return output;
}

function scopeNameForDraftPath(input: {
  home: string;
  role: string;
  cwd: string;
  draftPath: string;
}): string | null {
  const { home, role, cwd, draftPath } = input;
  const targetPath = resolve(draftPath);
  const globalConfigDir = globalConfigDirFor(home);

  if (targetPath === resolve(join(globalConfigDir, "global", "shared.yml"))) {
    return "global-shared";
  }
  if (role && targetPath === resolve(join(globalConfigDir, "global", "roles", `${role}.yml`))) {
    return "global-role";
  }

  for (const projectDir of findProjectChain(cwd)) {
    const resolvedProjectDir = resolve(projectDir);
    const myClaudeDir = join(resolvedProjectDir, ".myclaude");
    if (targetPath === resolve(join(myClaudeDir, "shared.yml"))) {
      return `project-shared:${resolvedProjectDir}`;
    }
    if (targetPath === resolve(join(myClaudeDir, "local.yml"))) {
      return `project-shared-local:${resolvedProjectDir}`;
    }
    if (role && targetPath === resolve(join(myClaudeDir, "roles", `${role}.yml`))) {
      return `project-role:${resolvedProjectDir}`;
    }
  }

  return null;
}

function projectSafePersonaPreview(result: PersonaRenderResult): PersonaPreviewProjection {
  const basenames: PersonaPreviewBasename[] = [];
  const claudeMdSections = result.claudeMd?.sections ?? [];

  for (const section of claudeMdSections) {
    basenames.push({
      category: "claudeMd",
      basename: safeBasename("claudeMd", section.sourcePath),
    });
  }

  for (const file of result.files) {
    basenames.push({
      category: file.category,
      basename: safeBasename(file.category, file.basename),
    });
  }

  const missingSources = groupMissingSources(result);
  const collisions = groupCollisions(result);
  const truncatedItemCount = Math.max(
    0,
    basenames.length + missingSources.length + collisions.length - MAX_SAFE_PREVIEW_ITEMS
  );

  return {
    categoryCounts: PERSONA_PREVIEW_CATEGORIES.map((category) => ({
      category,
      count: countRenderedCategory(result, category),
    })),
    basenames: basenames.slice(0, MAX_SAFE_PREVIEW_ITEMS),
    missingSources: missingSources.slice(0, MAX_SAFE_PREVIEW_ITEMS),
    collisions: collisions.slice(0, MAX_SAFE_PREVIEW_ITEMS),
    metrics: {
      claudeMdSectionCount: claudeMdSections.length,
      claudeMdCharacterCount: result.claudeMd?.combinedContent.length ?? 0,
      fileCount: result.files.length,
      fileCharacterCount: result.files.reduce((sum, file) => sum + file.content.length, 0),
      totalCharacterCount:
        (result.claudeMd?.combinedContent.length ?? 0) +
        result.files.reduce((sum, file) => sum + file.content.length, 0),
      truncatedItemCount,
    },
  };
}

function countRenderedCategory(
  result: PersonaRenderResult,
  category: PersonaPreviewCategory
): number {
  if (category === "claudeMd") return result.claudeMd?.sections.length ?? 0;
  return result.files.filter((file) => file.category === category).length;
}

function groupMissingSources(result: PersonaRenderResult): PersonaPreviewMissingSourceWarning[] {
  const grouped = new Map<string, PersonaPreviewMissingSourceWarning>();

  for (const source of result.missingSources) {
    const category = normalizePreviewCategory(source.category);
    const basename = safeBasename(category, source.sourcePath);
    const key = `${category}\0${basename}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, { category, basename, count: 1 });
  }

  return Array.from(grouped.values());
}

function groupCollisions(result: PersonaRenderResult): PersonaPreviewCollisionWarning[] {
  const grouped = new Map<string, PersonaPreviewCollisionWarning>();

  for (const collision of result.collisions) {
    const category = normalizeFilePreviewCategory(collision.category);
    if (!category) continue;
    const basename = safeBasename(category, collision.target);
    const key = `${category}\0${basename}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.hiddenCount += 1;
      continue;
    }
    grouped.set(key, { category, basename, hiddenCount: 1 });
  }

  return Array.from(grouped.values());
}

function normalizePreviewCategory(category: string): PersonaPreviewCategory {
  if (category === "commands") return "slashCmds";
  if (isPreviewCategory(category)) return category;
  return "memory";
}

function normalizeFilePreviewCategory(category: string): PersonaPreviewFileCategory | null {
  const normalized = category === "commands" ? "slashCmds" : category;
  return isPreviewFileCategory(normalized) ? normalized : null;
}

function isPreviewCategory(category: string): category is PersonaPreviewCategory {
  return PERSONA_PREVIEW_CATEGORIES.includes(category as PersonaPreviewCategory);
}

function isPreviewFileCategory(category: string): category is PersonaPreviewFileCategory {
  return PERSONA_PREVIEW_FILE_CATEGORIES.includes(category as PersonaPreviewFileCategory);
}

function safeBasename(category: PersonaPreviewCategory, value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const candidate =
    category === "skills" && /^skill\.md$/i.test(last) && segments.length > 1
      ? (segments[segments.length - 2] ?? last)
      : last;
  return sanitizeSummarySegment(candidate) ?? fallbackLabel(category);
}

function sanitizeSummarySegment(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (TOKEN_LIKE_RE.test(normalized) || UNSAFE_SUMMARY_RE.test(normalized)) return null;
  if (/[/\\]|\0|\$\{|\bsecret\b|\btoken\b|authorization|oauth/i.test(normalized)) return null;
  return normalized.slice(0, 80);
}

function fallbackLabel(category: PersonaPreviewCategory): string {
  switch (category) {
    case "claudeMd":
      return "Claude memory";
    case "agents":
      return "agent";
    case "skills":
      return "skill";
    case "slashCmds":
      return "slash command";
    case "memory":
      return "memory";
  }
}

import { type EffectiveSessionConfig, resolve as coreResolve } from "@agent-profile/core";
import { globalConfigDirFor, globalFragmentsDirFor } from "../paths.js";
import type { ProfileDiffEntry, ProfileIssue, ProfileResolvedPreview } from "./shared.js";
import { resolveCurrentProfile, summarizeEffectiveDiff, validateScopeContent } from "./shared.js";

export interface ProfilePreviewInput {
  home: string;
  role: string;
  authProfileId?: string;
  cwd: string;
  draft: {
    path: string;
    content: unknown;
  };
}

export interface ProfilePreviewResult {
  issues: ProfileIssue[];
  current: ProfileResolvedPreview;
  preview: ProfileResolvedPreview | null;
  diff: ProfileDiffEntry[];
}

export function profilePreviewService(input: ProfilePreviewInput): ProfilePreviewResult {
  const { home, role, authProfileId, cwd, draft } = input;
  const current = resolveCurrentProfile({
    home,
    role,
    cwd,
    ...(authProfileId !== undefined ? { authProfileId } : {}),
  });
  const parsedDraft = validateScopeContent(draft.content);

  if (!parsedDraft.doc) {
    return {
      issues: parsedDraft.issues,
      current: toResolvedPreview(current),
      preview: null,
      diff: [],
    };
  }

  const resolveInput: Parameters<typeof coreResolve>[0] = {
    role,
    cwd,
    launchOverrides: parsedDraft.doc,
    globalConfigDir: globalConfigDirFor(home),
    fragmentDirs: [globalFragmentsDirFor(home)],
  };
  if (authProfileId !== undefined) resolveInput.authProfileId = authProfileId;

  const previewResolved = coreResolve(resolveInput);

  return {
    issues: [],
    current: toResolvedPreview(current),
    preview: toResolvedPreview(previewResolved),
    diff: summarizeEffectiveDiff(current.effective, previewResolved.effective),
  };
}

function toResolvedPreview(result: EffectiveSessionConfig): ProfileResolvedPreview {
  return {
    effective: result.effective,
    provenance: result.provenance,
  };
}

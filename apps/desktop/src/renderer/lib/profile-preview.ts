import type { EffectiveConfig, DiffItem, ValidationIssue } from "./types.js";
import { isRecord, normalizeEffectiveState, normalizeValidationIssues } from "./normalize.js";

export type ProfilePreviewAdapterResult =
  | {
      status: "ready";
      effective: EffectiveConfig | null;
      diff: DiffItem[];
      issues: ValidationIssue[];
      errorMessage: null;
    }
  | {
      status: "error";
      effective: null;
      diff: [];
      issues: ValidationIssue[];
      errorMessage: string;
    };

export interface NormalizeProfilePreviewOptions {
  currentEffective: EffectiveConfig | null;
  createDiffSummary: (current: EffectiveConfig | null, preview: EffectiveConfig | null) => DiffItem[];
}

export function normalizeProfilePreviewResponse(
  input: unknown,
  options: NormalizeProfilePreviewOptions
): ProfilePreviewAdapterResult {
  if (!isRecord(input)) {
    return previewError("Profile preview returned an invalid response.", []);
  }

  if (isPreviewWrapper(input)) {
    return normalizePreviewWrapper(input, options);
  }

  if (isLegacyPreviewShape(input)) {
    const effective = normalizeEffectiveState(input).effective;
    return {
      status: "ready",
      effective,
      diff: options.createDiffSummary(options.currentEffective, effective),
      issues: [],
      errorMessage: null,
    };
  }

  return previewError("Profile preview response did not include a preview config.", []);
}

export function mergeValidationIssues(
  ...issueLists: Array<readonly ValidationIssue[]>
): ValidationIssue[] {
  const seen = new Set<string>();
  const merged: ValidationIssue[] = [];

  for (const issues of issueLists) {
    for (const issue of issues) {
      const key = `${issue.path}\0${issue.message}\0${issue.severity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(issue);
    }
  }

  return merged;
}

function normalizePreviewWrapper(
  input: Record<string, unknown>,
  options: NormalizeProfilePreviewOptions
): ProfilePreviewAdapterResult {
  const issues = normalizeValidationIssues(input.issues ?? []);
  const previewPayload = input.preview;

  if (previewPayload === null) {
    if (issues.length > 0) {
      return {
        status: "ready",
        effective: null,
        diff: [],
        issues,
        errorMessage: null,
      };
    }

    return previewError("Profile preview did not include a resolved preview config.", issues);
  }

  if (!isRecord(previewPayload)) {
    return previewError("Profile preview returned a malformed preview config.", issues);
  }

  const previewEffective = normalizeEffectiveState(previewPayload).effective;
  if (!previewEffective) {
    return previewError("Profile preview could not resolve an effective config.", issues);
  }

  const currentEffective = options.currentEffective ?? normalizeEffectiveState(input.current).effective;

  return {
    status: "ready",
    effective: previewEffective,
    diff: options.createDiffSummary(currentEffective, previewEffective),
    issues,
    errorMessage: null,
  };
}

function previewError(message: string, issues: ValidationIssue[]): ProfilePreviewAdapterResult {
  return {
    status: "error",
    effective: null,
    diff: [],
    issues,
    errorMessage: message,
  };
}

function isPreviewWrapper(input: Record<string, unknown>): boolean {
  return "preview" in input || "current" in input || "diff" in input || "issues" in input;
}

function isLegacyPreviewShape(input: Record<string, unknown>): boolean {
  return (
    "effective" in input ||
    "provenance" in input ||
    "mcpServers" in input ||
    "env" in input ||
    "settings" in input ||
    "persona" in input ||
    "auth" in input
  );
}

import type { ProfileIssue } from "./shared.js";
import { validateScopeContent } from "./shared.js";

export interface ProfileValidateInput {
  content: unknown;
}

export interface ProfileValidateResult {
  issues: ProfileIssue[];
}

export function profileValidateService(input: ProfileValidateInput): ProfileValidateResult {
  return {
    issues: validateScopeContent(input.content).issues,
  };
}

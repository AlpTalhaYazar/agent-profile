import type { ProfileScopeEntry } from "./shared.js";
import { listScopeEntries } from "./shared.js";

export interface ProfileListInput {
  home: string;
  cwd: string;
  roleFilter?: string;
}

export interface ProfileListResult {
  scopes: ProfileScopeEntry[];
}

export function profileListService(input: ProfileListInput): ProfileListResult {
  return {
    scopes: listScopeEntries(input),
  };
}

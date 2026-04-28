import { resolve } from "node:path";
import {
  assertAllowlistedScopePath,
  assertValidScopeDoc,
  writeCanonicalScopeFile,
} from "./shared.js";

export interface ProfileSaveInput {
  home: string;
  path: string;
  content: unknown;
}

export interface ProfileSaveResult {
  saved: true;
  path: string;
}

export function profileSaveService(input: ProfileSaveInput): ProfileSaveResult {
  const targetPath = assertAllowlistedScopePath(input.home, input.path);
  const doc = assertValidScopeDoc(input.content);
  writeCanonicalScopeFile(targetPath, doc);
  return {
    saved: true,
    path: resolve(targetPath),
  };
}

/**
 * Jotai atom registry for the renderer.
 *
 * Atoms own renderer-side state (selected scope, editor draft, validation
 * status, etc.). The `App` component subscribes to all of them; sub-trees
 * pick out specific atoms via `useAtomValue` / `useAtom`.
 */

import { atom } from "jotai";
import { stableStringify } from "./clone.js";
import type {
  AuthProfileOption,
  EditorMode,
  EffectiveState,
  JsonState,
  PreviewState,
  ScopeDoc,
  ScopeListEntry,
  ValidationState,
} from "./types.js";

export const scopeEntriesAtom = atom<ScopeListEntry[]>([]);
export const authProfilesAtom = atom<AuthProfileOption[]>([]);
export const availableRolesAtom = atom<string[]>([]);
export const selectedRoleAtom = atom("");
export const selectedAuthIdAtom = atom("");
export const cwdAtom = atom("");
export const versionAtom = atom<string | null>(null);
export const selectedScopePathAtom = atom<string | null>(null);
export const effectiveStateAtom = atom<EffectiveState>({ effective: null, provenance: null });
export const editorModeAtom = atom<EditorMode>("form");
export const draftDocAtom = atom<ScopeDoc | null>(null);
export const originalDocAtom = atom<ScopeDoc | null>(null);
export const jsonStateAtom = atom<JsonState>({ text: "", parseError: null });
export const settingsTextAtom = atom("{}");
export const settingsParseErrorAtom = atom<string | null>(null);
export const validationStateAtom = atom<ValidationState>({
  status: "idle",
  issues: [],
  errorMessage: null,
});
export const previewStateAtom = atom<PreviewState>({
  status: "idle",
  effective: null,
  diff: [],
  errorMessage: null,
});
export const appErrorAtom = atom<string | null>(null);
export const isBootstrappingAtom = atom(true);
export const isRefreshingAtom = atom(false);
export const isSavingAtom = atom(false);

export const selectedScopeAtom = atom((get) => {
  const selectedScopePath = get(selectedScopePathAtom);
  if (!selectedScopePath) return null;
  return get(scopeEntriesAtom).find((entry) => entry.path === selectedScopePath) ?? null;
});

export const selectedScopeLabelAtom = atom((get) => {
  const selectedScope = get(selectedScopeAtom);
  if (!selectedScope) return "No scope selected";
  const roleSuffix = selectedScope.role !== "—" ? `/${selectedScope.role}` : "";
  return `${selectedScope.scope}${roleSuffix}`;
});

export const hasUnsavedChangesAtom = atom((get) => {
  const draft = get(draftDocAtom);
  const original = get(originalDocAtom);
  if (!draft || !original) return false;
  return stableStringify(draft) !== stableStringify(original);
});

export const issuesByPathAtom = atom((get) => {
  const issues = get(validationStateAtom).issues;
  return new Map(issues.map((issue) => [issue.path, issue.message]));
});

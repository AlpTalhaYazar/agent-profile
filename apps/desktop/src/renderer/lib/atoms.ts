/**
 * Jotai atom registry for the renderer.
 *
 * Atoms own renderer-side state (selected scope, editor draft, validation
 * status, etc.). The `AppShell` component subscribes to all of them; sub-trees
 * pick out specific atoms via `useAtomValue` / `useAtom`.
 */

import { atom } from "jotai";
import { stableStringify } from "./clone.js";
import type {
  AuthProfileOption,
  EditorMode,
  EffectiveState,
  JsonState,
  PersonaState,
  PreviewState,
  ScopeDoc,
  ScopeListEntry,
  SelectedPersonaFile,
  SelectedProvenanceField,
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

// ─── App-level navigation (Phase 2 milestone 5 + 6) ──────────────────────────

export type AppScreen = "editor" | "auth-vault" | "sessions";
export type ProfileWorkspaceTab = "overview" | "layers" | "debug";
export type ProfileDebugTab = "provenance" | "persona";

export const currentScreenAtom = atom<AppScreen>("editor");
export const profileWorkspaceTabAtom = atom<ProfileWorkspaceTab>("overview");
export const profileDebugTabAtom = atom<ProfileDebugTab>("provenance");
export const activeTerminalSessionIdAtom = atom<string | null>(null);
export const themeAtom = atom<"dark" | "light">("dark");
export const commandPaletteOpenAtom = atom(false);
export const commandPaletteQueryAtom = atom("");
export const commandPaletteActiveIndexAtom = atom(0);

/**
 * Whether the desktop is on a fresh `~/.myclaude/` install. Sourced from the
 * `system.bootstrap` IPC response — `true` when `profileCount === 0` and the
 * `.setup-complete` marker file is missing. The shell reads this to decide
 * between mounting the first-run wizard and the main application.
 */
export const firstRunAtom = atom(false);
export const wizardStepAtom = atom<"welcome" | "auth" | "role" | "done">("welcome");
export const wizardDismissedAtom = atom(false);
export const shortcutsHelpOpenAtom = atom(false);
export const announceMessageAtom = atom("");

// ─── Provenance Inspector (Phase 2 milestone 6) ──────────────────────────────

export const selectedProvenanceFieldAtom = atom<SelectedProvenanceField | null>(null);

// ─── Persona Composer (Phase 2 milestone 6) ──────────────────────────────────

export const personaStateAtom = atom<PersonaState>({
  status: "idle",
  result: null,
  errorMessage: null,
});

export const selectedPersonaFileAtom = atom<SelectedPersonaFile | null>(null);

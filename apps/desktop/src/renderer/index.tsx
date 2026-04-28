import { Button, CodeEditor, Field, Input, Select, Switch, cn } from "@agent-profile/ui";
import { atom, useAtom, useAtomValue } from "jotai";
import * as React from "react";
import { createRoot } from "react-dom/client";
import "./global.css";

type MergeMode = "replace" | "deep";
type EditorMode = "form" | "json";
type TransportType = "stdio" | "http" | "streamable-http" | "sse";
type ScopeKind =
  | "global-shared"
  | "global-role"
  | "project-shared"
  | "project-shared-local"
  | "project-role"
  | string;

interface ScopeDocPersona {
  claudeMd?: string[];
  agents?: string[];
  skills?: string[];
  slashCmds?: string[];
  memory?: string[];
}

interface ScopeDocServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
  enabled?: boolean;
  __merge?: MergeMode;
  __extends?: string;
}

interface ScopeDoc {
  version: 1;
  mcpServers: Record<string, ScopeDocServerEntry | null>;
  auth?: { profileId: string };
  env: Record<string, string>;
  settings: Record<string, unknown>;
  persona?: ScopeDocPersona;
  use: string[];
  disabledServers: string[];
}

interface ScopeListEntry {
  scope: ScopeKind;
  role: string;
  path: string;
  content: ScopeDoc | null;
}

interface AuthProfileOption {
  id: string;
  displayName: string;
  mode: string;
  secretCount: number;
}

interface FieldProvenance {
  source?: string;
  chain?: string[];
}

interface McpServerProvenance {
  source?: string;
  suppressedBy?: string;
  overriddenFields?: string[];
  chain?: Array<{ scope?: string; event?: string }>;
}

interface Provenance {
  mcpServers: Record<string, McpServerProvenance>;
  env: Record<string, FieldProvenance>;
  settings: Record<string, FieldProvenance>;
  persona: Array<{ source?: string; files?: string[] }>;
}

interface EffectiveConfig {
  mcpServers: Record<string, ScopeDocServerEntry>;
  env: Record<string, string>;
  settings: Record<string, unknown>;
  persona: Required<ScopeDocPersona>;
  auth?: { profileId: string };
}

interface EffectiveState {
  effective: EffectiveConfig | null;
  provenance: Provenance | null;
}

interface ValidationIssue {
  path: string;
  message: string;
  severity: string;
}

interface ValidationState {
  status: "idle" | "loading" | "ready" | "error";
  issues: ValidationIssue[];
  errorMessage: string | null;
}

interface DiffItem {
  section: "mcpServers" | "env" | "settings" | "persona";
  key: string;
  change: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  effective: EffectiveConfig | null;
  diff: DiffItem[];
  errorMessage: string | null;
}

type JsonState = { text: string; parseError: null } | { text: string; parseError: string };

const scopeEntriesAtom = atom<ScopeListEntry[]>([]);
const authProfilesAtom = atom<AuthProfileOption[]>([]);
const availableRolesAtom = atom<string[]>([]);
const selectedRoleAtom = atom("");
const selectedAuthIdAtom = atom("");
const cwdAtom = atom("");
const versionAtom = atom<string | null>(null);
const selectedScopePathAtom = atom<string | null>(null);
const effectiveStateAtom = atom<EffectiveState>({ effective: null, provenance: null });
const editorModeAtom = atom<EditorMode>("form");
const draftDocAtom = atom<ScopeDoc | null>(null);
const originalDocAtom = atom<ScopeDoc | null>(null);
const jsonStateAtom = atom<JsonState>({ text: "", parseError: null });
const settingsTextAtom = atom("{}");
const settingsParseErrorAtom = atom<string | null>(null);
const validationStateAtom = atom<ValidationState>({
  status: "idle",
  issues: [],
  errorMessage: null,
});
const previewStateAtom = atom<PreviewState>({
  status: "idle",
  effective: null,
  diff: [],
  errorMessage: null,
});
const appErrorAtom = atom<string | null>(null);
const isBootstrappingAtom = atom(true);
const isRefreshingAtom = atom(false);
const isSavingAtom = atom(false);

const selectedScopeAtom = atom((get) => {
  const selectedScopePath = get(selectedScopePathAtom);
  if (!selectedScopePath) return null;
  return get(scopeEntriesAtom).find((entry) => entry.path === selectedScopePath) ?? null;
});

const selectedScopeLabelAtom = atom((get) => {
  const selectedScope = get(selectedScopeAtom);
  if (!selectedScope) return "No scope selected";
  const roleSuffix = selectedScope.role !== "—" ? `/${selectedScope.role}` : "";
  return `${selectedScope.scope}${roleSuffix}`;
});

const hasUnsavedChangesAtom = atom((get) => {
  const draft = get(draftDocAtom);
  const original = get(originalDocAtom);
  if (!draft || !original) return false;
  return stableStringify(draft) !== stableStringify(original);
});

const issuesByPathAtom = atom((get) => {
  const issues = get(validationStateAtom).issues;
  return new Map(issues.map((issue) => [issue.path, issue.message]));
});

function App(): React.ReactElement {
  const [version, setVersion] = useAtom(versionAtom);
  const [authProfiles, setAuthProfiles] = useAtom(authProfilesAtom);
  const [availableRoles, setAvailableRoles] = useAtom(availableRolesAtom);
  const [selectedRole, setSelectedRole] = useAtom(selectedRoleAtom);
  const [selectedAuthId, setSelectedAuthId] = useAtom(selectedAuthIdAtom);
  const [cwd, setCwd] = useAtom(cwdAtom);
  const [scopeEntries, setScopeEntries] = useAtom(scopeEntriesAtom);
  const [selectedScopePath, setSelectedScopePath] = useAtom(selectedScopePathAtom);
  const [effectiveState, setEffectiveState] = useAtom(effectiveStateAtom);
  const [draftDoc, setDraftDoc] = useAtom(draftDocAtom);
  const [originalDoc, setOriginalDoc] = useAtom(originalDocAtom);
  const [jsonState, setJsonState] = useAtom(jsonStateAtom);
  const [settingsText, setSettingsText] = useAtom(settingsTextAtom);
  const [settingsParseError, setSettingsParseError] = useAtom(settingsParseErrorAtom);
  const [validationState, setValidationState] = useAtom(validationStateAtom);
  const [previewState, setPreviewState] = useAtom(previewStateAtom);
  const [editorMode, setEditorMode] = useAtom(editorModeAtom);
  const [appError, setAppError] = useAtom(appErrorAtom);
  const [isBootstrapping, setIsBootstrapping] = useAtom(isBootstrappingAtom);
  const [isRefreshing, setIsRefreshing] = useAtom(isRefreshingAtom);
  const [isSaving, setIsSaving] = useAtom(isSavingAtom);
  const selectedScope = useAtomValue(selectedScopeAtom);
  const selectedScopeLabel = useAtomValue(selectedScopeLabelAtom);
  const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom);
  const issuesByPath = useAtomValue(issuesByPathAtom);
  const previewScrollTargets = React.useRef<Record<string, HTMLElement | null>>({});
  const previewPaneRef = React.useRef<HTMLDivElement | null>(null);

  const hydrateEditor = React.useCallback(
    (nextDoc: ScopeDoc | null) => {
      setDraftDoc(nextDoc ? cloneDoc(nextDoc) : null);
      setOriginalDoc(nextDoc ? cloneDoc(nextDoc) : null);
      setJsonState({
        text: nextDoc ? stringifyDoc(nextDoc) : "",
        parseError: null,
      });
      const nextSettings = nextDoc?.settings ?? {};
      setSettingsText(stringifyValue(nextSettings));
      setSettingsParseError(null);
      setValidationState({ status: "idle", issues: [], errorMessage: null });
      setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
    },
    [
      setDraftDoc,
      setJsonState,
      setOriginalDoc,
      setPreviewState,
      setSettingsParseError,
      setSettingsText,
      setValidationState,
    ]
  );

  const refreshData = React.useCallback(
    async (nextCwd: string, nextRole: string, nextAuthId: string, preserveSelection = true) => {
      const bridge = window.myclaude;
      if (!bridge?.profile?.list || !bridge.profile.show) {
        setAppError("Renderer bridge is incomplete. Waiting for profile.list/profile.show.");
        return;
      }

      setIsRefreshing(true);
      setAppError(null);
      try {
        const [listed, shown] = await Promise.all([
          bridge.profile.list({
            cwd: nextCwd,
            ...(nextRole ? { roleFilter: nextRole } : {}),
          }),
          nextRole && nextAuthId
            ? bridge.profile.show({ role: nextRole, authProfileId: nextAuthId, cwd: nextCwd })
            : Promise.resolve(null),
        ]);

        const normalizedEntries = normalizeScopeList(listed);
        setScopeEntries(normalizedEntries);

        const preferredPath =
          preserveSelection && selectedScopePath
            ? normalizedEntries.find((entry) => entry.path === selectedScopePath)?.path
            : null;
        const fallbackPath = normalizedEntries[0]?.path ?? null;
        const nextSelectedPath = preferredPath ?? fallbackPath;
        setSelectedScopePath(nextSelectedPath);

        const normalizedShown = normalizeEffectiveState(shown);
        setEffectiveState(normalizedShown);

        const nextScope =
          normalizedEntries.find((entry) => entry.path === nextSelectedPath) ??
          normalizedEntries[0] ??
          null;
        hydrateEditor(nextScope?.content ?? null);
      } catch (error) {
        setAppError(getErrorMessage(error));
      } finally {
        setIsRefreshing(false);
      }
    },
    [
      hydrateEditor,
      selectedScopePath,
      setAppError,
      setEffectiveState,
      setIsRefreshing,
      setScopeEntries,
      setSelectedScopePath,
    ]
  );

  React.useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setIsBootstrapping(true);
      setAppError(null);
      try {
        const bridge = window.myclaude;
        const nextVersion =
          (await bridge?.system?.version?.().catch(() => null)) ??
          (await bridge?.version?.().catch(() => null)) ??
          "unavailable";
        const nextCwd =
          (await bridge?.system?.defaultCwd?.().catch(() => null)) ??
          (typeof window.location.pathname === "string" ? window.location.pathname : "");
        const listed = bridge?.profile?.list ? await bridge.profile.list({ cwd: nextCwd }) : [];
        const normalizedEntries = normalizeScopeList(listed);
        const roles = collectRoles(normalizedEntries);
        const authList = bridge?.auth?.list ? await bridge.auth.list() : [];
        const normalizedAuthProfiles = normalizeAuthProfiles(authList);

        if (cancelled) return;

        setVersion(nextVersion);
        setCwd(nextCwd);
        setScopeEntries(normalizedEntries);
        setAvailableRoles(roles);
        setAuthProfiles(normalizedAuthProfiles);

        const initialRole = roles[0] ?? "";
        const initialAuthId = normalizedAuthProfiles[0]?.id ?? "";
        setSelectedRole(initialRole);
        setSelectedAuthId(initialAuthId);
        setSelectedScopePath(normalizedEntries[0]?.path ?? null);

        if (initialRole && initialAuthId && nextCwd && bridge?.profile?.show) {
          const shown = await bridge.profile.show({
            role: initialRole,
            authProfileId: initialAuthId,
            cwd: nextCwd,
          });
          if (cancelled) return;
          setEffectiveState(normalizeEffectiveState(shown));
        }

        const initialScope = normalizedEntries[0] ?? null;
        hydrateEditor(initialScope?.content ?? null);
      } catch (error) {
        if (!cancelled) setAppError(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    hydrateEditor,
    setAppError,
    setAuthProfiles,
    setAvailableRoles,
    setCwd,
    setEffectiveState,
    setIsBootstrapping,
    setScopeEntries,
    setSelectedAuthId,
    setSelectedRole,
    setSelectedScopePath,
    setVersion,
  ]);

  React.useEffect(() => {
    if (!selectedScope) return;
    hydrateEditor(selectedScope.content ?? null);
  }, [selectedScope, hydrateEditor]);

  React.useEffect(() => {
    if (isBootstrapping) return;
    if (!cwd || !selectedRole || !selectedAuthId) return;
    void refreshData(cwd, selectedRole, selectedAuthId);
  }, [cwd, isBootstrapping, refreshData, selectedAuthId, selectedRole]);

  React.useEffect(() => {
    if (!draftDoc || !selectedScope || settingsParseError || jsonState.parseError) {
      setValidationState((current) =>
        current.status === "idle" ? current : { status: "idle", issues: [], errorMessage: null }
      );
      setPreviewState((current) =>
        current.status === "idle"
          ? current
          : { status: "idle", effective: null, diff: [], errorMessage: null }
      );
      return;
    }

    const bridge = window.myclaude;
    const profileApi = bridge?.profile;
    if (!profileApi?.validate || !profileApi.preview || !selectedRole || !selectedAuthId || !cwd) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setValidationState((current) => ({ ...current, status: "loading" }));
      setPreviewState((current) => ({ ...current, status: "loading" }));

      void Promise.all([
        profileApi.validate({ content: draftDoc }),
        profileApi.preview({
          role: selectedRole,
          authProfileId: selectedAuthId,
          cwd,
          draft: { path: selectedScope.path, content: draftDoc },
        }),
      ])
        .then(([validationResult, previewResult]) => {
          if (cancelled) return;
          const issues = normalizeValidationIssues(validationResult);
          const previewEffective = normalizeEffectiveState(previewResult).effective;
          const diff = createDiffSummary(effectiveState.effective, previewEffective);
          setValidationState({
            status: "ready",
            issues,
            errorMessage: null,
          });
          setPreviewState({
            status: "ready",
            effective: previewEffective,
            diff,
            errorMessage: null,
          });
        })
        .catch((error) => {
          if (cancelled) return;
          const message = getErrorMessage(error);
          setValidationState({
            status: "error",
            issues: [],
            errorMessage: message,
          });
          setPreviewState({
            status: "error",
            effective: null,
            diff: [],
            errorMessage: message,
          });
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    cwd,
    draftDoc,
    effectiveState.effective,
    jsonState.parseError,
    selectedAuthId,
    selectedRole,
    selectedScope,
    setPreviewState,
    setValidationState,
    settingsParseError,
  ]);

  React.useEffect(() => {
    if (!selectedScope || !effectiveState.effective) return;
    const targetKey = previewTargetKey(selectedScope);
    const target = previewScrollTargets.current[targetKey];
    if (!target || !previewPaneRef.current) return;
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [effectiveState.effective, selectedScope]);

  const updateDraft = React.useCallback(
    (updater: (current: ScopeDoc) => ScopeDoc) => {
      setDraftDoc((current) => {
        if (!current) return current;
        const next = updater(cloneDoc(current));
        setJsonState({ text: stringifyDoc(next), parseError: null });
        return next;
      });
    },
    [setDraftDoc, setJsonState]
  );

  const updateSettingsObject = React.useCallback(
    (text: string) => {
      setSettingsText(text);
      try {
        const parsed = parseJsonObject(text);
        setSettingsParseError(null);
        updateDraft((current) => ({ ...current, settings: parsed }));
      } catch (error) {
        setSettingsParseError(getErrorMessage(error));
      }
    },
    [setSettingsParseError, setSettingsText, updateDraft]
  );

  const updateJsonMode = React.useCallback(
    (text: string) => {
      setJsonState({ text, parseError: null });
      try {
        const parsed = normalizeScopeDoc(parseJsonObject(text));
        setJsonState({ text, parseError: null });
        setSettingsText(stringifyValue(parsed.settings));
        setSettingsParseError(null);
        setDraftDoc(parsed);
      } catch (error) {
        setJsonState({ text, parseError: getErrorMessage(error) });
      }
    },
    [setDraftDoc, setJsonState, setSettingsParseError, setSettingsText]
  );

  const handlePickDirectory = React.useCallback(async () => {
    const picked = await window.myclaude?.system?.pickDirectory?.().catch(() => null);
    if (picked) setCwd(picked);
  }, [setCwd]);

  const handleRevert = React.useCallback(() => {
    hydrateEditor(originalDoc ? cloneDoc(originalDoc) : null);
  }, [hydrateEditor, originalDoc]);

  const handleSave = React.useCallback(async () => {
    if (!selectedScope || !draftDoc || settingsParseError || jsonState.parseError) return;
    const bridge = window.myclaude;
    if (!bridge?.profile?.save) {
      setAppError("Renderer bridge is incomplete. Waiting for profile.save.");
      return;
    }

    setIsSaving(true);
    setAppError(null);
    try {
      await bridge.profile.save({ path: selectedScope.path, content: draftDoc });
      await refreshData(cwd, selectedRole, selectedAuthId, true);
    } catch (error) {
      setAppError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, [
    cwd,
    draftDoc,
    jsonState.parseError,
    refreshData,
    selectedAuthId,
    selectedRole,
    selectedScope,
    setAppError,
    setIsSaving,
    settingsParseError,
  ]);

  const envError = issuesByPath.get("env");
  const settingsError = settingsParseError ?? issuesByPath.get("settings");
  const versionError = issuesByPath.get("version");
  const authBindingValue = draftDoc?.auth?.profileId ?? "";
  const previewEffective = previewState.effective ?? effectiveState.effective;
  const editorDisabled = !draftDoc;
  const invalidDraft = Boolean(settingsParseError || jsonState.parseError);

  return (
    <main className="flex h-full min-h-full flex-col bg-neutral-100 text-neutral-950">
      <header className="border-b border-neutral-200 bg-white">
        <div className="grid grid-cols-1 gap-3 px-4 py-3 xl:grid-cols-[1.2fr_1fr_1.2fr_auto]">
          <Field
            description="Resolve project scopes from this directory."
            label="Working directory"
          >
            <div className="flex gap-2">
              <Input
                aria-label="Working directory"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setCwd(event.target.value)
                }
                value={cwd}
              />
              <Button onClick={() => void handlePickDirectory()} type="button" variant="secondary">
                Browse
              </Button>
            </div>
          </Field>
          <Field description="Select the role-scoped cascade." label="Role">
            <Select
              aria-label="Role"
              onValueChange={setSelectedRole}
              options={availableRoles.map((role) => ({ value: role, label: role }))}
              value={selectedRole}
            />
          </Field>
          <Field description="Auth metadata only; secrets remain in Main." label="Auth profile">
            <Select
              aria-label="Auth profile"
              onValueChange={setSelectedAuthId}
              options={authProfiles.map((profile) => ({
                value: profile.id,
                label: `${profile.displayName || profile.id} (${profile.mode})`,
              }))}
              value={selectedAuthId}
            />
          </Field>
          <div className="flex min-w-0 flex-col justify-end gap-1 text-sm text-neutral-500">
            <span className="truncate">Version {version ?? "loading"}</span>
            <span className="truncate">
              {isRefreshing ? "Refreshing scopes" : isBootstrapping ? "Bootstrapping" : "Ready"}
            </span>
          </div>
        </div>
        {appError ? (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {appError}
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="app-scrollbar min-h-0 overflow-auto border-r border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h1 className="text-base font-semibold">Profile Explorer</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Scope files for{" "}
              <span className="font-medium text-neutral-700">{selectedRole || "—"}</span>
            </p>
          </div>
          <ScopeTree
            entries={scopeEntries}
            onSelect={setSelectedScopePath}
            selectedPath={selectedScopePath}
          />
        </aside>

        <section className="grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div
            className="app-scrollbar min-h-0 overflow-auto border-b border-neutral-200 bg-neutral-50 xl:border-b-0 xl:border-r"
            ref={previewPaneRef}
          >
            <div className="border-b border-neutral-200 px-4 py-3">
              <h2 className="text-base font-semibold">Effective preview</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Resolved for {selectedRole || "—"} @ {selectedAuthId || "—"}
              </p>
            </div>

            <PreviewSummary
              effective={previewEffective}
              setTargetRef={(key, element) => {
                previewScrollTargets.current[key] = element;
              }}
              selectedScope={selectedScope}
              provenance={effectiveState.provenance}
            />

            <div className="border-t border-neutral-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Draft impact</h3>
                <span className="text-xs text-neutral-500">
                  {previewState.status === "loading"
                    ? "Previewing"
                    : previewState.status === "error"
                      ? "Preview failed"
                      : `${previewState.diff.length} changes`}
                </span>
              </div>
              {previewState.errorMessage ? (
                <p className="mt-2 text-sm text-red-700">{previewState.errorMessage}</p>
              ) : previewState.diff.length > 0 ? (
                <ul className="mt-3 grid gap-2 text-sm">
                  {previewState.diff.slice(0, 16).map((item) => (
                    <li
                      className="grid gap-1 rounded-md border border-neutral-200 bg-white px-3 py-2"
                      key={`${item.section}:${item.key}:${item.change}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-900">{item.key}</span>
                        <span className="text-xs uppercase tracking-wide text-neutral-500">
                          {item.section}
                        </span>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            item.change === "added" && "text-emerald-700",
                            item.change === "removed" && "text-red-700",
                            item.change === "changed" && "text-amber-700"
                          )}
                        >
                          {item.change}
                        </span>
                      </div>
                      {item.before ? (
                        <span className="font-mono text-xs text-neutral-500">- {item.before}</span>
                      ) : null}
                      {item.after ? (
                        <span className="font-mono text-xs text-neutral-700">+ {item.after}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-neutral-500">
                  {invalidDraft
                    ? "Preview waits for valid JSON inputs."
                    : "No observable effective changes yet."}
                </p>
              )}
            </div>
          </div>

          <div className="app-scrollbar min-h-0 overflow-auto bg-white">
            <div className="border-b border-neutral-200 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Profile Editor</h2>
                  <p className="mt-1 text-sm text-neutral-500">
                    Editing {selectedScopeLabel}
                    {selectedScope ? ` • ${selectedScope.path}` : ""}
                  </p>
                </div>
                <div className="inline-flex rounded-md bg-neutral-100 p-1">
                  <button
                    className={cn(
                      "inline-flex h-7 items-center justify-center rounded px-3 text-sm font-medium transition-colors",
                      editorMode === "form"
                        ? "bg-white text-neutral-950 shadow-sm"
                        : "text-neutral-600 hover:bg-neutral-200"
                    )}
                    onClick={() => setEditorMode("form")}
                    type="button"
                  >
                    Form
                  </button>
                  <button
                    className={cn(
                      "inline-flex h-7 items-center justify-center rounded px-3 text-sm font-medium transition-colors",
                      editorMode === "json"
                        ? "bg-white text-neutral-950 shadow-sm"
                        : "text-neutral-600 hover:bg-neutral-200"
                    )}
                    onClick={() => setEditorMode("json")}
                    type="button"
                  >
                    JSON
                  </button>
                </div>
              </div>
            </div>

            <div className="border-b border-neutral-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={!hasUnsavedChanges || invalidDraft || isSaving || editorDisabled}
                  onClick={() => void handleSave()}
                  type="button"
                  variant="primary"
                >
                  {isSaving ? "Saving" : "Save"}
                </Button>
                <Button
                  disabled={!hasUnsavedChanges || isSaving || editorDisabled}
                  onClick={handleRevert}
                  type="button"
                  variant="secondary"
                >
                  Revert
                </Button>
                <span className="text-sm text-neutral-500">
                  {validationState.status === "loading"
                    ? "Validating"
                    : validationState.status === "error"
                      ? "Validation failed"
                      : validationState.issues.length > 0
                        ? `${validationState.issues.length} issues`
                        : hasUnsavedChanges
                          ? "Ready to save"
                          : "No changes"}
                </span>
              </div>

              {validationState.errorMessage ? (
                <p className="mt-2 text-sm text-red-700">{validationState.errorMessage}</p>
              ) : null}

              {validationState.issues.length > 0 || settingsParseError || jsonState.parseError ? (
                <div className="mt-3 grid gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  {settingsParseError ? <div>settings: {settingsParseError}</div> : null}
                  {jsonState.parseError ? <div>json: {jsonState.parseError}</div> : null}
                  {validationState.issues.slice(0, 8).map((issue) => (
                    <div key={`${issue.path}:${issue.message}`}>
                      <span className="font-medium">{issue.path || "document"}:</span>{" "}
                      {issue.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {editorMode === "form" ? (
              <FormEditor
                authBindingValue={authBindingValue}
                disabled={editorDisabled}
                doc={draftDoc}
                envError={envError}
                settingsError={settingsError}
                settingsText={settingsText}
                updateDraft={updateDraft}
                updateSettingsObject={updateSettingsObject}
                versionError={versionError}
              />
            ) : (
              <div className="h-[calc(100vh-18rem)] min-h-[34rem] p-4">
                <CodeEditor
                  ariaLabel="Profile JSON editor"
                  height="100%"
                  onChange={updateJsonMode}
                  value={jsonState.text}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

interface ScopeTreeProps {
  entries: ScopeListEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function ScopeTree({ entries, selectedPath, onSelect }: ScopeTreeProps): React.ReactElement {
  const groupedEntries = React.useMemo(() => {
    const order: ScopeKind[] = [
      "global-shared",
      "global-role",
      "project-shared",
      "project-shared-local",
      "project-role",
    ];
    return order
      .map((scope) => ({
        scope,
        entries: entries.filter((entry) => entry.scope === scope),
      }))
      .filter((group) => group.entries.length > 0);
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-neutral-500">
        No scope files discovered for the current directory.
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      {groupedEntries.map((group) => (
        <section
          className="border-b border-neutral-100 px-2 py-2 last:border-b-0"
          key={group.scope}
        >
          <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {group.scope}
          </h2>
          <ul className="grid gap-1">
            {group.entries.map((entry) => {
              const stats = scopeEntryStats(entry.content);
              return (
                <li key={entry.path}>
                  <button
                    className={cn(
                      "grid w-full gap-1 rounded-md border border-transparent px-2 py-2 text-left transition-colors",
                      selectedPath === entry.path
                        ? "border-neutral-300 bg-neutral-100"
                        : "hover:bg-neutral-50"
                    )}
                    onClick={() => onSelect(entry.path)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-neutral-900">
                        {entry.role !== "—" ? entry.role : leafName(entry.path)}
                      </span>
                      <span className="text-xs text-neutral-400">{stats.servers} srv</span>
                    </div>
                    <div className="truncate text-xs text-neutral-500">{entry.path}</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-neutral-500">
                      <span>{stats.env} env</span>
                      <span>{stats.settings} settings</span>
                      <span>{stats.persona} persona</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface PreviewSummaryProps {
  effective: EffectiveConfig | null;
  provenance: Provenance | null;
  selectedScope: ScopeListEntry | null;
  setTargetRef: (key: string, element: HTMLElement | null) => void;
}

function PreviewSummary({
  effective,
  provenance,
  selectedScope,
  setTargetRef,
}: PreviewSummaryProps): React.ReactElement {
  const selectedScopeToken = scopeSelectionToken(selectedScope);
  const settingsEntries = React.useMemo(
    () => flattenObject(effective?.settings ?? {}),
    [effective?.settings]
  );

  return (
    <div>
      <section
        className={sectionClassName("summary", selectedScopeToken)}
        ref={(element) => setTargetRef("summary", element)}
      >
        <h3 className="text-sm font-semibold">Summary</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm xl:grid-cols-4">
          <SummaryMetric
            label="MCP servers"
            value={String(Object.keys(effective?.mcpServers ?? {}).length)}
          />
          <SummaryMetric
            label="Env vars"
            value={String(Object.keys(effective?.env ?? {}).length)}
          />
          <SummaryMetric label="Settings" value={String(settingsEntries.length)} />
          <SummaryMetric
            label="Persona files"
            value={String(
              Object.values(effective?.persona ?? {}).reduce(
                (count, paths) => count + paths.length,
                0
              )
            )}
          />
        </div>
      </section>

      <section
        className={sectionClassName("mcpServers", selectedScopeToken)}
        ref={(element) => setTargetRef("mcpServers", element)}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">MCP servers</h3>
          <span className="text-xs text-neutral-500">
            {Object.keys(effective?.mcpServers ?? {}).length} active
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-md border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Transport</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {Object.entries(effective?.mcpServers ?? {}).map(([name, server]) => {
                const source = provenance?.mcpServers?.[name]?.source ?? "—";
                const suppressedBy = provenance?.mcpServers?.[name]?.suppressedBy;
                return (
                  <tr key={name}>
                    <td className="px-3 py-2 font-medium text-neutral-900">{name}</td>
                    <td className="px-3 py-2 text-neutral-600">{transportLabel(server)}</td>
                    <td className="px-3 py-2 text-neutral-600">{source}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {suppressedBy
                        ? `Suppressed by ${suppressedBy}`
                        : server.enabled === false
                          ? "Disabled"
                          : "Enabled"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className={sectionClassName("env", selectedScopeToken)}
        ref={(element) => setTargetRef("env", element)}
      >
        <h3 className="text-sm font-semibold">Environment</h3>
        <div className="mt-3 grid gap-2">
          {Object.entries(effective?.env ?? {}).map(([key, value]) => (
            <div
              className="grid gap-1 rounded-md border border-neutral-200 bg-white px-3 py-2"
              key={key}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-900">{key}</span>
                <span className="text-xs text-neutral-500">
                  {provenance?.env?.[key]?.source ?? "—"}
                </span>
              </div>
              <div className="font-mono text-xs text-neutral-600">{redactText(value)}</div>
            </div>
          ))}
        </div>
      </section>

      <section
        className={sectionClassName("settings", selectedScopeToken)}
        ref={(element) => setTargetRef("settings", element)}
      >
        <h3 className="text-sm font-semibold">Settings</h3>
        <div className="mt-3 grid gap-2">
          {settingsEntries.length > 0 ? (
            settingsEntries.map(([key, value]) => (
              <div
                className="grid gap-1 rounded-md border border-neutral-200 bg-white px-3 py-2"
                key={key}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-900">{key}</span>
                  <span className="text-xs text-neutral-500">
                    {provenance?.settings?.[key]?.source ?? "—"}
                  </span>
                </div>
                <div className="font-mono text-xs text-neutral-600">{stringifyInline(value)}</div>
              </div>
            ))
          ) : (
            <p className="text-sm text-neutral-500">No settings in the resolved config.</p>
          )}
        </div>
      </section>

      <section
        className={sectionClassName("persona", selectedScopeToken)}
        ref={(element) => setTargetRef("persona", element)}
      >
        <h3 className="text-sm font-semibold">Persona</h3>
        <div className="mt-3 grid gap-4">
          {Object.entries(effective?.persona ?? emptyPersona()).map(([label, paths]) => (
            <div className="grid gap-1" key={label}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-900">{label}</span>
                <span className="text-xs text-neutral-500">{paths.length}</span>
              </div>
              {paths.length > 0 ? (
                <ul className="grid gap-1 text-xs text-neutral-600">
                  {paths.map((path) => (
                    <li className="truncate font-mono" key={`${label}:${path}`}>
                      {path}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-500">None</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

interface SummaryMetricProps {
  label: string;
  value: string;
}

function SummaryMetric({ label, value }: SummaryMetricProps): React.ReactElement {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

interface FormEditorProps {
  doc: ScopeDoc | null;
  disabled: boolean;
  versionError: string | undefined;
  envError: string | undefined;
  settingsError: string | undefined;
  settingsText: string;
  authBindingValue: string;
  updateDraft: (updater: (current: ScopeDoc) => ScopeDoc) => void;
  updateSettingsObject: (text: string) => void;
}

function FormEditor({
  doc,
  disabled,
  versionError,
  envError,
  settingsError,
  settingsText,
  authBindingValue,
  updateDraft,
  updateSettingsObject,
}: FormEditorProps): React.ReactElement {
  if (!doc) {
    return (
      <div className="px-4 py-8 text-sm text-neutral-500">
        Select a scope entry with content to start editing.
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-200">
      <section className="px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-3">
          <Field {...(versionError !== undefined ? { error: versionError } : {})} label="Version">
            <Input
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const nextVersion = Number(event.target.value || 1);
                updateDraft((current) => ({ ...current, version: nextVersion === 1 ? 1 : 1 }));
              }}
              value={String(doc.version)}
            />
          </Field>
          <Field description="Optional auth binding written into the scope." label="Auth binding">
            <Input
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const nextValue = event.target.value.trim();
                updateDraft((current) =>
                  nextValue
                    ? { ...current, auth: { profileId: nextValue } }
                    : removeAuthBinding(current)
                );
              }}
              placeholder="work"
              value={authBindingValue}
            />
          </Field>
          <Field description="Reusable fragment names expanded before merge." label="Use fragments">
            <StringListEditor
              disabled={disabled}
              onChange={(values) => updateDraft((current) => ({ ...current, use: values }))}
              values={doc.use}
            />
          </Field>
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Field
            description="Document-level environment entries."
            {...(envError !== undefined ? { error: envError } : {})}
            label="Environment"
          >
            <KeyValueEditor
              addLabel="Add variable"
              disabled={disabled}
              onChange={(pairs) =>
                updateDraft((current) => ({ ...current, env: pairsToRecord(pairs) }))
              }
              pairs={recordToPairs(doc.env)}
              valueLabel="Value"
            />
          </Field>

          <Field
            description="Compact JSON object merged into settings.json."
            {...(settingsError !== undefined ? { error: settingsError } : {})}
            label="Settings"
          >
            <textarea
              className="min-h-44 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-950"
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                updateSettingsObject(event.target.value)
              }
              value={settingsText}
            />
          </Field>
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">MCP servers</h3>
            <p className="mt-1 text-sm text-neutral-500">
              Transport-aware fields for stdio, HTTP, and SSE.
            </p>
          </div>
          <Button
            disabled={disabled}
            onClick={() =>
              updateDraft((current) => {
                const nextName = uniqueServerName(current.mcpServers);
                return {
                  ...current,
                  mcpServers: {
                    ...current.mcpServers,
                    [nextName]: defaultServerEntry("stdio"),
                  },
                };
              })
            }
            type="button"
            variant="secondary"
          >
            Add server
          </Button>
        </div>
        <div className="mt-4 grid gap-4">
          {Object.entries(doc.mcpServers).length > 0 ? (
            Object.entries(doc.mcpServers).map(([name, entry]) => (
              <ServerEditor
                disabled={disabled}
                entry={entry}
                key={name}
                name={name}
                onChange={(nextName, nextEntry) =>
                  updateDraft((current) => {
                    const nextServers = { ...current.mcpServers };
                    delete nextServers[name];
                    nextServers[nextName] = nextEntry;
                    return { ...current, mcpServers: nextServers };
                  })
                }
                onDelete={() =>
                  updateDraft((current) => {
                    const nextServers = { ...current.mcpServers };
                    delete nextServers[name];
                    return { ...current, mcpServers: nextServers };
                  })
                }
              />
            ))
          ) : (
            <p className="text-sm text-neutral-500">No servers in this scope.</p>
          )}
        </div>
      </section>

      <section className="px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Field description="Scope-level tombstones." label="Disabled servers">
            <StringListEditor
              disabled={disabled}
              onChange={(values) =>
                updateDraft((current) => ({ ...current, disabledServers: values }))
              }
              values={doc.disabledServers}
            />
          </Field>

          <div className="grid gap-4">
            <PathListField
              disabled={disabled}
              label="CLAUDE.md paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, claudeMd: values },
                }))
              }
              values={doc.persona?.claudeMd ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Agent paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, agents: values },
                }))
              }
              values={doc.persona?.agents ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Skill paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, skills: values },
                }))
              }
              values={doc.persona?.skills ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Slash command paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, slashCmds: values },
                }))
              }
              values={doc.persona?.slashCmds ?? []}
            />
            <PathListField
              disabled={disabled}
              label="Memory seed paths"
              onChange={(values) =>
                updateDraft((current) => ({
                  ...current,
                  persona: { ...current.persona, memory: values },
                }))
              }
              values={doc.persona?.memory ?? []}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

interface ServerEditorProps {
  name: string;
  entry: ScopeDocServerEntry | null;
  disabled: boolean;
  onChange: (name: string, entry: ScopeDocServerEntry | null) => void;
  onDelete: () => void;
}

function ServerEditor({
  name,
  entry,
  disabled,
  onChange,
  onDelete,
}: ServerEditorProps): React.ReactElement {
  if (entry === null) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-neutral-900">{name}</div>
            <div className="mt-1 text-sm text-neutral-500">Tombstoned in this scope.</div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={disabled}
              onClick={() => onChange(name, defaultServerEntry("stdio"))}
              type="button"
              variant="secondary"
            >
              Restore
            </Button>
            <Button disabled={disabled} onClick={onDelete} type="button" variant="ghost">
              Remove row
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const transport = inferTransport(entry);
  const argsValue = (entry.args ?? []).join("\n");
  const headerPairs = recordToPairs(entry.headers);
  const envPairs = recordToPairs(entry.env);

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_10rem]">
          <Field label="Name">
            <Input
              disabled={disabled}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(event.target.value.toLowerCase() || name, entry)
              }
              value={name}
            />
          </Field>
          <Field label="Transport">
            <Select
              aria-label={`${name} transport`}
              disabled={disabled}
              onValueChange={(value: string) =>
                onChange(name, migrateServerTransport(entry, value as TransportType))
              }
              options={[
                { value: "stdio", label: "stdio" },
                { value: "http", label: "http" },
                { value: "streamable-http", label: "streamable-http" },
                { value: "sse", label: "sse" },
              ]}
              value={transport}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-neutral-700">
            <Switch
              checked={entry.enabled ?? true}
              disabled={disabled}
              onCheckedChange={(checked: boolean) =>
                onChange(name, { ...entry, enabled: Boolean(checked) })
              }
            />
            Enabled
          </div>
          <Button disabled={disabled} onClick={onDelete} type="button" variant="ghost">
            Remove
          </Button>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 xl:grid-cols-3">
        <Field label="__extends">
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(name, setOptionalString(entry, "__extends", event.target.value))
            }
            placeholder="global-role"
            value={entry.__extends ?? ""}
          />
        </Field>
        <Field label="__merge">
          <Select
            aria-label={`${name} merge mode`}
            disabled={disabled}
            onValueChange={(value: string) =>
              onChange(name, { ...entry, __merge: value as MergeMode })
            }
            options={[
              { value: "replace", label: "replace" },
              { value: "deep", label: "deep" },
            ]}
            value={entry.__merge ?? "replace"}
          />
        </Field>
      </div>

      <div className="grid gap-4 border-t border-neutral-200 px-4 py-4 xl:grid-cols-2">
        {transport === "stdio" ? (
          <>
            <Field label="Command">
              <Input
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onChange(name, { ...entry, command: event.target.value })
                }
                placeholder="npx"
                value={entry.command ?? ""}
              />
            </Field>
            <Field description="One argument per line." label="Args">
              <textarea
                className="min-h-28 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-neutral-950"
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  onChange(name, { ...entry, args: splitLines(event.target.value) })
                }
                value={argsValue}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <Input
                disabled={disabled}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onChange(name, { ...entry, url: event.target.value })
                }
                placeholder={
                  transport === "sse" ? "https://example.test/sse" : "https://example.test/mcp"
                }
                value={entry.url ?? ""}
              />
            </Field>
            <Field description="Basic header map for HTTP and SSE transports." label="Headers">
              <KeyValueEditor
                addLabel="Add header"
                disabled={disabled}
                onChange={(pairs) => onChange(name, { ...entry, headers: pairsToRecord(pairs) })}
                pairs={headerPairs}
                valueLabel="Value"
              />
            </Field>
          </>
        )}
      </div>

      <div className="border-t border-neutral-200 px-4 py-4">
        <Field description="Server-specific environment variables." label="Env">
          <KeyValueEditor
            addLabel="Add env"
            disabled={disabled}
            onChange={(pairs) => onChange(name, { ...entry, env: pairsToRecord(pairs) })}
            pairs={envPairs}
            valueLabel="Value"
          />
        </Field>
      </div>
    </div>
  );
}

interface PathListFieldProps {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}

function PathListField({
  label,
  values,
  disabled,
  onChange,
}: PathListFieldProps): React.ReactElement {
  return (
    <Field label={label}>
      <StringListEditor disabled={disabled} onChange={onChange} values={values} />
    </Field>
  );
}

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  disabled: boolean;
  addLabel: string;
  valueLabel: string;
}

function KeyValueEditor({
  pairs,
  onChange,
  disabled,
  addLabel,
  valueLabel,
}: KeyValueEditorProps): React.ReactElement {
  return (
    <div className="grid gap-2">
      {pairs.map((pair) => (
        <div
          className="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,1.5fr)_auto]"
          key={pair.id}
        >
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                pairs.map((candidate) =>
                  candidate.id === pair.id ? { ...candidate, key: event.target.value } : candidate
                )
              )
            }
            placeholder="KEY"
            value={pair.key}
          />
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                pairs.map((candidate) =>
                  candidate.id === pair.id ? { ...candidate, value: event.target.value } : candidate
                )
              )
            }
            placeholder={valueLabel}
            value={pair.value}
          />
          <Button
            disabled={disabled}
            onClick={() => onChange(pairs.filter((candidate) => candidate.id !== pair.id))}
            type="button"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        disabled={disabled}
        onClick={() =>
          onChange([
            ...pairs,
            {
              id: createId(),
              key: "",
              value: "",
            },
          ])
        }
        type="button"
        variant="secondary"
      >
        {addLabel}
      </Button>
    </div>
  );
}

interface StringListEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
}

function StringListEditor({
  values,
  onChange,
  disabled,
}: StringListEditorProps): React.ReactElement {
  const items = React.useMemo(() => {
    const seen = new Map<string, number>();
    return values.map((value, position) => {
      const count = (seen.get(value) ?? 0) + 1;
      seen.set(value, count);
      return {
        id: `${value || "__empty__"}:${count}`,
        position,
        value,
      };
    });
  }, [values]);

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" key={item.id}>
          <Input
            disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(
                values.map((candidate, candidateIndex) =>
                  candidateIndex === item.position ? event.target.value : candidate
                )
              )
            }
            value={item.value}
          />
          <Button
            disabled={disabled}
            onClick={() =>
              onChange(values.filter((_, candidateIndex) => candidateIndex !== item.position))
            }
            type="button"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
        type="button"
        variant="secondary"
      >
        Add path
      </Button>
    </div>
  );
}

function normalizeAuthProfiles(input: unknown): AuthProfileOption[] {
  const candidates = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.profiles)
      ? input.profiles
      : [];

  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = asString(candidate.id);
    if (!id) return [];
    return [
      {
        id,
        displayName: asString(candidate.displayName) ?? id,
        mode: asString(candidate.mode) ?? "unknown",
        secretCount: Array.isArray(candidate.secrets) ? candidate.secrets.length : 0,
      },
    ];
  });
}

function normalizeScopeList(input: unknown): ScopeListEntry[] {
  const candidates = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.entries)
      ? input.entries
      : isRecord(input) && Array.isArray(input.scopes)
        ? input.scopes
        : [];

  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const path =
      asString(candidate.path) ?? asString(candidate.filePath) ?? asString(candidate.scopePath);
    const scope = asString(candidate.scope) ?? "unknown";
    if (!path) return [];
    const contentCandidate = candidate.content ?? candidate.doc ?? candidate.scopeDoc ?? null;
    return [
      {
        path,
        scope,
        role: asString(candidate.role) ?? "—",
        content: normalizeMaybeScopeDoc(contentCandidate),
      },
    ];
  });
}

function normalizeEffectiveState(input: unknown): EffectiveState {
  if (!input || !isRecord(input)) return { effective: null, provenance: null };
  const effectiveCandidate =
    isRecord(input.effective) || Array.isArray(input.effective) ? input.effective : input;
  const provenanceCandidate = isRecord(input.provenance) ? input.provenance : null;
  return {
    effective: normalizeEffectiveConfig(effectiveCandidate),
    provenance: normalizeProvenance(provenanceCandidate),
  };
}

function normalizeEffectiveConfig(input: unknown): EffectiveConfig | null {
  if (!isRecord(input)) return null;
  const persona = isRecord(input.persona) ? input.persona : {};
  return {
    mcpServers: normalizeServersRecord(input.mcpServers),
    env: normalizeStringRecord(input.env),
    settings: normalizeUnknownRecord(input.settings),
    persona: {
      claudeMd: normalizeStringArray(persona.claudeMd),
      agents: normalizeStringArray(persona.agents),
      skills: normalizeStringArray(persona.skills),
      slashCmds: normalizeStringArray(persona.slashCmds),
      memory: normalizeStringArray(persona.memory),
    },
    ...(isRecord(input.auth) && typeof input.auth.profileId === "string"
      ? { auth: { profileId: input.auth.profileId } }
      : {}),
  };
}

function normalizeProvenance(input: unknown): Provenance | null {
  if (!isRecord(input)) return null;
  return {
    mcpServers: isRecord(input.mcpServers)
      ? (input.mcpServers as Record<string, McpServerProvenance>)
      : {},
    env: isRecord(input.env) ? (input.env as Record<string, FieldProvenance>) : {},
    settings: isRecord(input.settings) ? (input.settings as Record<string, FieldProvenance>) : {},
    persona: Array.isArray(input.persona) ? (input.persona as Provenance["persona"]) : [],
  };
}

function normalizeValidationIssues(input: unknown): ValidationIssue[] {
  if (Array.isArray(input)) {
    return input.flatMap((issue) => normalizeValidationIssue(issue));
  }

  if (isRecord(input) && Array.isArray(input.issues)) {
    return input.issues.flatMap((issue) => normalizeValidationIssue(issue));
  }

  if (isRecord(input) && typeof input.ok === "boolean") {
    return input.ok ? [] : [{ path: "document", message: "Validation failed", severity: "error" }];
  }

  if (typeof input === "string") {
    return [{ path: "document", message: input, severity: "error" }];
  }

  return [];
}

function normalizeValidationIssue(input: unknown): ValidationIssue[] {
  if (typeof input === "string") {
    return [{ path: "document", message: input, severity: "error" }];
  }
  if (!isRecord(input)) return [];
  return [
    {
      path: asString(input.path) ?? asString(input.fieldPath) ?? "document",
      message: asString(input.message) ?? "Validation issue",
      severity: asString(input.severity) ?? "error",
    },
  ];
}

function normalizeMaybeScopeDoc(input: unknown): ScopeDoc | null {
  if (!isRecord(input)) return null;
  return normalizeScopeDoc(input);
}

function normalizeScopeDoc(input: unknown): ScopeDoc {
  const record = isRecord(input) ? input : {};
  // ScopeDoc schema requires version: 1 (literal); normalize unknown shapes to 1.
  const version: 1 = 1;
  const persona = normalizePersona(record.persona);
  return {
    version,
    mcpServers: normalizeNullableServerRecord(record.mcpServers),
    env: normalizeStringRecord(record.env),
    settings: normalizeUnknownRecord(record.settings),
    use: normalizeStringArray(record.use),
    disabledServers: normalizeStringArray(record.disabledServers),
    ...(isRecord(record.auth) && typeof record.auth.profileId === "string"
      ? { auth: { profileId: record.auth.profileId } }
      : {}),
    ...(persona ? { persona } : {}),
  };
}

function normalizePersona(input: unknown): ScopeDocPersona | undefined {
  if (!isRecord(input)) return undefined;
  return {
    claudeMd: normalizeStringArray(input.claudeMd),
    agents: normalizeStringArray(input.agents),
    skills: normalizeStringArray(input.skills),
    slashCmds: normalizeStringArray(input.slashCmds),
    memory: normalizeStringArray(input.memory),
  };
}

function removeAuthBinding(scopeDoc: ScopeDoc): ScopeDoc {
  const { auth: _auth, ...next } = scopeDoc;
  return next;
}

function normalizeNullableServerRecord(input: unknown): Record<string, ScopeDocServerEntry | null> {
  if (!isRecord(input)) return {};
  const next: Record<string, ScopeDocServerEntry | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) {
      next[key] = null;
      continue;
    }
    if (!isRecord(value)) continue;
    next[key] = {
      ...(typeof value.type === "string" ? { type: value.type } : {}),
      ...(typeof value.command === "string" ? { command: value.command } : {}),
      ...(Array.isArray(value.args) ? { args: normalizeStringArray(value.args) } : {}),
      ...(isRecord(value.env) ? { env: normalizeStringRecord(value.env) } : {}),
      ...(isRecord(value.headers) ? { headers: normalizeStringRecord(value.headers) } : {}),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(typeof value.__merge === "string" ? { __merge: value.__merge as MergeMode } : {}),
      ...(typeof value.__extends === "string" ? { __extends: value.__extends } : {}),
    };
  }
  return next;
}

function normalizeServersRecord(input: unknown): Record<string, ScopeDocServerEntry> {
  const nullable = normalizeNullableServerRecord(input);
  return Object.fromEntries(
    Object.entries(nullable).flatMap(([name, value]) => (value ? [[name, value]] : []))
  );
}

function normalizeStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string")
    : [];
}

function normalizeStringRecord(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : []
    )
  );
}

function normalizeUnknownRecord(input: unknown): Record<string, unknown> {
  return isRecord(input) ? { ...input } : {};
}

function createDiffSummary(
  current: EffectiveConfig | null,
  preview: EffectiveConfig | null
): DiffItem[] {
  if (!current || !preview) return [];
  const items: DiffItem[] = [];

  for (const key of sortedUnion(Object.keys(current.mcpServers), Object.keys(preview.mcpServers))) {
    const before = current.mcpServers[key];
    const after = preview.mcpServers[key];
    if (!before && after) {
      items.push({
        section: "mcpServers",
        key,
        change: "added",
        after: summarizeServer(after),
      });
    } else if (before && !after) {
      items.push({
        section: "mcpServers",
        key,
        change: "removed",
        before: summarizeServer(before),
      });
    } else if (before && after && stableStringify(before) !== stableStringify(after)) {
      items.push({
        section: "mcpServers",
        key,
        change: "changed",
        before: summarizeServer(before),
        after: summarizeServer(after),
      });
    }
  }

  for (const key of sortedUnion(Object.keys(current.env), Object.keys(preview.env))) {
    const before = current.env[key];
    const after = preview.env[key];
    if (before === undefined && after !== undefined) {
      items.push({ section: "env", key, change: "added", after: redactText(after) });
    } else if (before !== undefined && after === undefined) {
      items.push({ section: "env", key, change: "removed", before: redactText(before) });
    } else if (before !== after && before !== undefined && after !== undefined) {
      items.push({
        section: "env",
        key,
        change: "changed",
        before: redactText(before),
        after: redactText(after),
      });
    }
  }

  const currentSettings = flattenObject(current.settings);
  const previewSettings = flattenObject(preview.settings);
  for (const key of sortedUnion(
    currentSettings.map(([path]) => path),
    previewSettings.map(([path]) => path)
  )) {
    const before = currentSettings.find(([path]) => path === key)?.[1];
    const after = previewSettings.find(([path]) => path === key)?.[1];
    if (before === undefined && after !== undefined) {
      items.push({ section: "settings", key, change: "added", after: stringifyInline(after) });
    } else if (before !== undefined && after === undefined) {
      items.push({ section: "settings", key, change: "removed", before: stringifyInline(before) });
    } else if (stableStringify(before) !== stableStringify(after)) {
      items.push({
        section: "settings",
        key,
        change: "changed",
        before: stringifyInline(before),
        after: stringifyInline(after),
      });
    }
  }

  for (const label of Object.keys(emptyPersona()) as Array<keyof Required<ScopeDocPersona>>) {
    const before = current.persona[label];
    const after = preview.persona[label];
    if (stableStringify(before) !== stableStringify(after)) {
      items.push({
        section: "persona",
        key: label,
        change: before.length === 0 ? "added" : after.length === 0 ? "removed" : "changed",
        before: before.join(", "),
        after: after.join(", "),
      });
    }
  }

  return items;
}

function collectRoles(entries: ScopeListEntry[]): string[] {
  return Array.from(
    new Set(entries.map((entry) => entry.role).filter((role) => role && role !== "—"))
  ).sort();
}

function emptyPersona(): Required<ScopeDocPersona> {
  return {
    claudeMd: [],
    agents: [],
    skills: [],
    slashCmds: [],
    memory: [],
  };
}

function cloneDoc(doc: ScopeDoc): ScopeDoc {
  return structuredClone(doc);
}

function stringifyDoc(doc: ScopeDoc): string {
  return JSON.stringify(doc, null, 2);
}

function stringifyValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }
  return value;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error("Expected a JSON object");
  return parsed;
}

function recordToPairs(record?: Record<string, string>): KeyValuePair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    id: createId(),
    key,
    value,
  }));
}

function pairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  return Object.fromEntries(
    pairs.filter((pair) => pair.key.trim().length > 0).map((pair) => [pair.key.trim(), pair.value])
  );
}

function defaultServerEntry(transport: TransportType): ScopeDocServerEntry {
  if (transport === "stdio") {
    return { type: "stdio", command: "", args: [], env: {}, enabled: true, __merge: "replace" };
  }
  return {
    type: transport,
    url: "",
    headers: {},
    env: {},
    enabled: true,
    __merge: "replace",
  };
}

function migrateServerTransport(
  entry: ScopeDocServerEntry,
  transport: TransportType
): ScopeDocServerEntry {
  const base: ScopeDocServerEntry = {
    enabled: entry.enabled ?? true,
    __merge: entry.__merge ?? "replace",
    ...(entry.__extends ? { __extends: entry.__extends } : {}),
    ...(entry.env ? { env: entry.env } : {}),
  };

  if (transport === "stdio") {
    return {
      ...base,
      type: "stdio",
      command: entry.command ?? "",
      args: entry.args ?? [],
    };
  }

  return {
    ...base,
    type: transport,
    url: entry.url ?? "",
    headers: entry.headers ?? {},
  };
}

function inferTransport(entry: ScopeDocServerEntry): TransportType {
  if (entry.type === "http" || entry.type === "streamable-http" || entry.type === "sse") {
    return entry.type;
  }
  if (typeof entry.url === "string" && entry.url.length > 0) return "http";
  return "stdio";
}

function transportLabel(server: ScopeDocServerEntry): string {
  return inferTransport(server);
}

function summarizeServer(server: ScopeDocServerEntry): string {
  const transport = inferTransport(server);
  if (transport === "stdio") {
    return `${transport} ${server.command ?? ""}`.trim();
  }
  return `${transport} ${server.url ?? ""}`.trim();
}

function previewTargetKey(scope: ScopeListEntry): string {
  const content = scope.content;
  if (!content) return "summary";
  if (Object.keys(content.mcpServers).length > 0) return "mcpServers";
  if (Object.keys(content.env).length > 0) return "env";
  if (Object.keys(content.settings).length > 0) return "settings";
  return "persona";
}

function scopeSelectionToken(scope: ScopeListEntry | null): string | null {
  if (!scope) return null;
  return previewTargetKey(scope);
}

function sectionClassName(section: string, selectedSection: string | null): string {
  return cn(
    "border-b border-neutral-200 px-4 py-4 last:border-b-0",
    selectedSection === section && "bg-amber-50/50"
  );
}

function leafName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function scopeEntryStats(content: ScopeDoc | null): {
  servers: number;
  env: number;
  settings: number;
  persona: number;
} {
  return {
    servers: Object.keys(content?.mcpServers ?? {}).length,
    env: Object.keys(content?.env ?? {}).length,
    settings: Object.keys(content?.settings ?? {}).length,
    persona: Object.values(content?.persona ?? {}).reduce(
      (count, value) => count + (Array.isArray(value) ? value.length : 0),
      0
    ),
  };
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function setOptionalString<T extends ScopeDocServerEntry, K extends "__extends">(
  entry: T,
  key: K,
  value: string
): T {
  const trimmed = value.trim();
  if (!trimmed) {
    const next = { ...entry };
    delete next[key];
    return next;
  }
  return { ...entry, [key]: trimmed };
}

function uniqueServerName(servers: Record<string, ScopeDocServerEntry | null>): string {
  let index = 1;
  let candidate = "server";
  while (candidate in servers) {
    index += 1;
    candidate = `server-${index}`;
  }
  return candidate;
}

function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function flattenObject(value: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(nested)) {
      entries.push(...flattenObject(nested, path));
    } else {
      entries.push([path, nested]);
    }
  }
  return entries;
}

function sortedUnion(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).sort();
}

function stringifyInline(value: unknown): string {
  if (typeof value === "string") return redactText(value);
  return JSON.stringify(value);
}

function redactText(value: string): string {
  return /secret:|keyring:\/\//i.test(value) ? "•••• redacted ref ••••" : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}

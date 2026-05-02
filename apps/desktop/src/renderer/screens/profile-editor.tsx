/**
 * @module screens/profile-editor
 *
 * The Profile Editor screen — three-pane layout (scope tree, effective
 * preview, editor). Owns the data-fetching effects (`refreshData`,
 * draft validation/preview debounce) plus the form/JSON mode toggle.
 *
 * Extracted from `index.tsx` as part of ST-2 of Phase 2 milestone 7. The
 * extraction preserves behavior 1:1: the same atoms drive the same effects;
 * the only change is that local component state (`previewScrollTargets`,
 * `previewPaneRef`) and inline JSX moved into this file rather than living
 * on `App`.
 */

import { Button, CodeEditor, Field, Input, Select, cn } from "@agent-profile/ui";
import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import { FormEditor } from "../components/form-editor.js";
import { useAnnounce } from "../components/live-announcer.js";
import {
  PreviewSummary,
  ProfileEditorInspector,
  createDiffSummary,
  previewTargetKey,
} from "../components/preview-panel.js";
import { ScopeTree } from "../components/scope-tree.js";
import {
  appErrorAtom,
  authProfilesAtom,
  availableRolesAtom,
  cwdAtom,
  draftDocAtom,
  editorModeAtom,
  effectiveStateAtom,
  hasUnsavedChangesAtom,
  isBootstrappingAtom,
  isRefreshingAtom,
  isSavingAtom,
  issuesByPathAtom,
  jsonStateAtom,
  originalDocAtom,
  previewStateAtom,
  scopeEntriesAtom,
  selectedAuthIdAtom,
  selectedRoleAtom,
  selectedScopeAtom,
  selectedScopeLabelAtom,
  selectedScopePathAtom,
  settingsParseErrorAtom,
  settingsTextAtom,
  themeAtom,
  validationStateAtom,
  versionAtom,
} from "../lib/atoms.js";
import { cloneDoc, parseJsonObject, stringifyDoc, stringifyValue } from "../lib/clone.js";
import {
  getErrorMessage,
  normalizeEffectiveState,
  normalizeScopeDoc,
  normalizeScopeList,
  normalizeValidationIssues,
} from "../lib/normalize.js";
import type { ScopeDoc } from "../lib/types.js";

export function ProfileEditorScreen(): React.ReactElement {
  const [authProfiles] = useAtom(authProfilesAtom);
  const [availableRoles] = useAtom(availableRolesAtom);
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
  const [isBootstrapping] = useAtom(isBootstrappingAtom);
  const [isRefreshing, setIsRefreshing] = useAtom(isRefreshingAtom);
  const [isSaving, setIsSaving] = useAtom(isSavingAtom);
  const selectedScope = useAtomValue(selectedScopeAtom);
  const selectedScopeLabel = useAtomValue(selectedScopeLabelAtom);
  const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom);
  const issuesByPath = useAtomValue(issuesByPathAtom);
  const version = useAtomValue(versionAtom);
  const previewScrollTargets = React.useRef<Record<string, HTMLElement | null>>({});
  const previewPaneRef = React.useRef<HTMLDivElement | null>(null);
  const announce = useAnnounce();

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
      announce("Profile saved");
    } catch (error) {
      const message = getErrorMessage(error);
      setAppError(message);
      announce(`Save failed: ${message}`);
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
    announce,
    setAppError,
    setIsSaving,
    settingsParseError,
  ]);

  React.useEffect(() => {
    if (validationState.status === "ready") {
      announce(
        validationState.issues.length > 0
          ? `${validationState.issues.length} validation issues`
          : "Validation passed"
      );
    } else if (validationState.status === "error" && validationState.errorMessage) {
      announce(`Validation failed: ${validationState.errorMessage}`);
    }
  }, [
    announce,
    validationState.errorMessage,
    validationState.issues.length,
    validationState.status,
  ]);

  const envError = issuesByPath.get("env");
  const settingsError = settingsParseError ?? issuesByPath.get("settings");
  const versionError = issuesByPath.get("version");
  const authBindingValue = draftDoc?.auth?.profileId ?? "";
  const previewEffective = previewState.effective ?? effectiveState.effective;
  const editorDisabled = !draftDoc;
  const invalidDraft = Boolean(settingsParseError || jsonState.parseError);

  return (
    <div
      aria-busy={
        isBootstrapping ||
        isRefreshing ||
        isSaving ||
        validationState.status === "loading" ||
        previewState.status === "loading"
      }
      className="flex h-full min-h-0 flex-col bg-canvas"
    >
      <header className="border-b border-subtle bg-surface">
        <div className="grid grid-cols-1 gap-3 px-4 py-3 window-large:grid-cols-[1.2fr_1fr_1.2fr_auto]">
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
          <div className="flex min-w-0 flex-col justify-end gap-1 text-sm text-secondary">
            <span className="truncate">Version {version ?? "loading"}</span>
            <span className="truncate">
              {isRefreshing ? "Refreshing scopes" : isBootstrapping ? "Bootstrapping" : "Ready"}
            </span>
          </div>
        </div>
        {appError ? (
          <div className="border-t border-status-danger bg-status-danger-soft px-4 py-2 text-sm text-status-danger">
            {appError}
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 window-medium:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="app-scrollbar min-h-0 overflow-auto border-r border-default bg-surface">
          <div className="border-b border-subtle px-4 py-3">
            <h2 className="text-base font-semibold text-primary">Profile Explorer</h2>
            <p className="mt-1 text-sm text-secondary">
              Scope files for{" "}
              <span className="font-medium text-primary">{selectedRole || "—"}</span>
            </p>
          </div>
          <ScopeTree
            entries={scopeEntries}
            onSelect={setSelectedScopePath}
            selectedPath={selectedScopePath}
          />
        </aside>

        <section className="grid min-h-0 grid-cols-1 window-large:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div
            className="app-scrollbar min-h-0 overflow-auto border-b border-default bg-subtle window-large:border-b-0 window-large:border-r"
            ref={previewPaneRef}
          >
            <div className="border-b border-subtle px-4 py-3">
              <h2 className="text-base font-semibold text-primary">Effective preview</h2>
              <p className="mt-1 text-sm text-secondary">
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

            <div className="border-t border-subtle px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-primary">Draft impact</h3>
                <span className="text-xs text-secondary">
                  {previewState.status === "loading"
                    ? "Previewing"
                    : previewState.status === "error"
                      ? "Preview failed"
                      : `${previewState.diff.length} changes`}
                </span>
              </div>
              {previewState.errorMessage ? (
                <p className="mt-2 text-sm text-status-danger">{previewState.errorMessage}</p>
              ) : previewState.diff.length > 0 ? (
                <ul className="mt-3 grid gap-2 text-sm">
                  {previewState.diff.slice(0, 16).map((item) => (
                    <li
                      className="grid gap-1 rounded-md border border-default bg-surface px-3 py-2"
                      key={`${item.section}:${item.key}:${item.change}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-primary">{item.key}</span>
                        <span className="text-xs uppercase tracking-wide text-secondary">
                          {item.section}
                        </span>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            item.change === "added" && "text-status-success",
                            item.change === "removed" && "text-status-danger",
                            item.change === "changed" && "text-status-warning"
                          )}
                        >
                          {item.change}
                        </span>
                      </div>
                      {item.before ? (
                        <span className="font-mono text-xs text-secondary">- {item.before}</span>
                      ) : null}
                      {item.after ? (
                        <span className="font-mono text-xs text-primary">+ {item.after}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-secondary">
                  {invalidDraft
                    ? "Preview waits for valid JSON inputs."
                    : "No observable effective changes yet."}
                </p>
              )}
            </div>
          </div>

          <div className="app-scrollbar min-h-0 overflow-auto bg-surface">
            <div className="border-b border-subtle px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1
                    className="text-base font-semibold text-primary"
                    id="screen-heading"
                    tabIndex={-1}
                  >
                    Profile Editor
                  </h1>
                  <p className="mt-1 text-sm text-secondary">
                    Editing {selectedScopeLabel}
                    {selectedScope ? ` • ${selectedScope.path}` : ""}
                  </p>
                </div>
                <div className="inline-flex rounded-md border border-default bg-subtle p-1">
                  <button
                    className={cn(
                      "inline-flex h-7 items-center justify-center rounded px-3 text-sm font-medium transition-colors",
                      editorMode === "form"
                        ? "bg-surface text-primary shadow-xs"
                        : "text-secondary hover:bg-elevated"
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
                        ? "bg-surface text-primary shadow-xs"
                        : "text-secondary hover:bg-elevated"
                    )}
                    onClick={() => setEditorMode("json")}
                    type="button"
                  >
                    JSON
                  </button>
                </div>
              </div>
            </div>

            <div className="border-b border-subtle px-4 py-3">
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
                <span className="text-sm text-secondary">
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
                <p className="mt-2 text-sm text-status-danger">{validationState.errorMessage}</p>
              ) : null}

              {validationState.issues.length > 0 || settingsParseError || jsonState.parseError ? (
                <div className="mt-3 grid gap-2 rounded-md border border-status-warning bg-status-warning-soft px-3 py-3 text-sm text-status-warning">
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
    </div>
  );
}

/**
 * Inspector aside rendered alongside the Profile Editor screen by the shell.
 * Re-exports `ProfileEditorInspector` so the shell can import this component
 * from a single screen module.
 */
export function ProfileEditorScreenInspector(): React.ReactElement {
  const appError = useAtomValue(appErrorAtom);
  const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom);
  const isBootstrapping = useAtomValue(isBootstrappingAtom);
  const isRefreshing = useAtomValue(isRefreshingAtom);
  const previewState = useAtomValue(previewStateAtom);
  const selectedAuthId = useAtomValue(selectedAuthIdAtom);
  const selectedRole = useAtomValue(selectedRoleAtom);
  const selectedScope = useAtomValue(selectedScopeAtom);
  const theme = useAtomValue(themeAtom);
  const validationState = useAtomValue(validationStateAtom);
  const version = useAtomValue(versionAtom);
  const settingsParseError = useAtomValue(settingsParseErrorAtom);
  const jsonState = useAtomValue(jsonStateAtom);
  const invalidDraft = Boolean(settingsParseError || jsonState.parseError);

  return (
    <ProfileEditorInspector
      appError={appError}
      hasUnsavedChanges={hasUnsavedChanges}
      invalidDraft={invalidDraft}
      isBootstrapping={isBootstrapping}
      isRefreshing={isRefreshing}
      previewState={previewState}
      selectedAuthId={selectedAuthId}
      selectedRole={selectedRole}
      selectedScope={selectedScope}
      theme={theme}
      validationState={validationState}
      version={version}
    />
  );
}

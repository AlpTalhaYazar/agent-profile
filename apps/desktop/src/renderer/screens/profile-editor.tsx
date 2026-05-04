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

import {
  Button,
  CodeEditor,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Select,
  cn,
} from "@agent-profile/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Database,
  ExternalLink,
  FileStack,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Layers,
  ListChecks,
  PackagePlus,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  UserRound,
  Variable,
} from "lucide-react";
import * as React from "react";
import type { SkillCatalogItem, WorkspaceCandidateOption } from "../../shared/bridge.js";
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
  ActionBanner,
  IconTile,
  InfoPanel,
  ScreenHeader,
  ScreenSurface,
  StatusChip,
} from "../components/screen-ui.js";
import { defaultServerEntry } from "../components/server-form.js";
import {
  activeTerminalSessionIdAtom,
  appErrorAtom,
  authProfilesAtom,
  availableRolesAtom,
  currentScreenAtom,
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
  profileDebugTabAtom,
  profileWorkspaceTabAtom,
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
import { PersonaComposerScreen } from "./persona-composer.js";
import { ProvenanceInspectorScreen } from "./provenance-inspector.js";

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
  const [workspaceTab, setWorkspaceTab] = useAtom(profileWorkspaceTabAtom);
  const [debugTab, setDebugTab] = useAtom(profileDebugTabAtom);
  const [appError, setAppError] = useAtom(appErrorAtom);
  const [isBootstrapping] = useAtom(isBootstrappingAtom);
  const [isRefreshing, setIsRefreshing] = useAtom(isRefreshingAtom);
  const [isSaving, setIsSaving] = useAtom(isSavingAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const setActiveTerminalSessionId = useSetAtom(activeTerminalSessionIdAtom);
  const selectedScope = useAtomValue(selectedScopeAtom);
  const selectedScopeLabel = useAtomValue(selectedScopeLabelAtom);
  const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom);
  const issuesByPath = useAtomValue(issuesByPathAtom);
  const version = useAtomValue(versionAtom);
  const previewScrollTargets = React.useRef<Record<string, HTMLElement | null>>({});
  const previewPaneRef = React.useRef<HTMLDivElement | null>(null);
  const announce = useAnnounce();
  const [launching, setLaunching] = React.useState(false);
  const [createScopeOpen, setCreateScopeOpen] = React.useState(false);
  const [addMcpOpen, setAddMcpOpen] = React.useState(false);
  const [skillsCatalogOpen, setSkillsCatalogOpen] = React.useState(false);
  const [recentCwds, setRecentCwds] = React.useState<string[]>(() => loadRecentCwds());
  const [workspaceCandidates, setWorkspaceCandidates] = React.useState<WorkspaceCandidateOption[]>(
    []
  );

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
    if (!cwd) return;
    setRecentCwds((current) => storeRecentCwd(cwd, current));
  }, [cwd]);

  React.useEffect(() => {
    let active = true;
    if (!cwd) {
      setWorkspaceCandidates([]);
      return () => {
        active = false;
      };
    }
    const systemApi = window.myclaude?.system;
    if (!systemApi?.workspaceCandidates) {
      setWorkspaceCandidates([]);
      return () => {
        active = false;
      };
    }

    void systemApi
      .workspaceCandidates({ cwd })
      .then((candidates) => {
        if (active) setWorkspaceCandidates(candidates);
      })
      .catch(() => {
        if (active) setWorkspaceCandidates([]);
      });

    return () => {
      active = false;
    };
  }, [cwd]);

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

  const selectLayerForRole = React.useCallback(
    (role: string) => {
      const matchingRoleLayer = scopeEntries.find(
        (entry) => entry.content && entry.role === role && entry.scope.includes("role")
      );
      const fallbackLayer =
        scopeEntries.find((entry) => entry.content && entry.path === selectedScopePath) ??
        scopeEntries.find((entry) => entry.content) ??
        null;
      const target = matchingRoleLayer ?? fallbackLayer;
      if (target) {
        setSelectedScopePath(target.path);
      }
      setWorkspaceTab("layers");
    },
    [scopeEntries, selectedScopePath, setSelectedScopePath, setWorkspaceTab]
  );

  const stageScopeDraft = React.useCallback(
    (path: string, updater: (current: ScopeDoc) => ScopeDoc): boolean => {
      const entry = scopeEntries.find((candidate) => candidate.path === path);
      if (!entry?.content) {
        setAppError("Create or select a writable layer before editing MCP or skills.");
        return false;
      }
      if (path !== selectedScopePath && hasUnsavedChanges) {
        setAppError("Save or revert the current layer before editing another layer.");
        return false;
      }

      const baseDoc =
        path === selectedScopePath && draftDoc ? cloneDoc(draftDoc) : cloneDoc(entry.content);
      const originalBase =
        path === selectedScopePath && originalDoc ? cloneDoc(originalDoc) : cloneDoc(entry.content);
      const nextDoc = updater(baseDoc);
      setSelectedScopePath(path);
      setDraftDoc(nextDoc);
      setOriginalDoc(originalBase);
      setJsonState({ text: stringifyDoc(nextDoc), parseError: null });
      setSettingsText(stringifyValue(nextDoc.settings ?? {}));
      setSettingsParseError(null);
      setValidationState({ status: "idle", issues: [], errorMessage: null });
      setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
      setWorkspaceTab("layers");
      return true;
    },
    [
      draftDoc,
      hasUnsavedChanges,
      originalDoc,
      scopeEntries,
      selectedScopePath,
      setAppError,
      setDraftDoc,
      setJsonState,
      setOriginalDoc,
      setPreviewState,
      setSelectedScopePath,
      setSettingsParseError,
      setSettingsText,
      setValidationState,
      setWorkspaceTab,
    ]
  );

  const handleCreateScope = React.useCallback(
    async (input: {
      location: "global" | "project";
      layerType: "shared" | "role";
      role?: string;
      force?: boolean;
    }) => {
      const profileApi = window.myclaude?.profile;
      if (!profileApi?.createScope) {
        setAppError("Renderer bridge is incomplete. Waiting for profile.createScope.");
        return;
      }
      if (!cwd) {
        setAppError("Select a working directory before creating a project layer.");
        return;
      }

      setAppError(null);
      try {
        const result = await profileApi.createScope({
          cwd,
          location: input.location,
          layerType: input.layerType,
          ...(input.role ? { role: input.role } : {}),
          ...(input.force ? { force: input.force } : {}),
        });
        const nextRole = result.role ?? selectedRole;
        if (result.role) setSelectedRole(result.role);
        await refreshData(cwd, nextRole, selectedAuthId, false);
        setSelectedScopePath(result.path);
        hydrateEditor(normalizeScopeDoc(result.content));
        setWorkspaceTab("layers");
        announce("Layer created");
      } catch (error) {
        const message = getErrorMessage(error);
        setAppError(message);
        announce(`Layer create failed: ${message}`);
      }
    },
    [
      announce,
      cwd,
      hydrateEditor,
      refreshData,
      selectedAuthId,
      selectedRole,
      setAppError,
      setSelectedRole,
      setSelectedScopePath,
      setWorkspaceTab,
    ]
  );

  const handleAddMcpServer = React.useCallback(
    (targetPath: string, name: string, transport: "stdio" | "http" | "streamable-http" | "sse") => {
      const normalizedName = normalizeConfigName(name);
      if (!normalizedName) {
        setAppError("MCP server name must match [a-z0-9_-]+.");
        return false;
      }
      const changed = stageScopeDraft(targetPath, (current) => {
        const serverName = uniqueMcpServerName(current.mcpServers, normalizedName);
        return {
          ...current,
          mcpServers: {
            ...current.mcpServers,
            [serverName]: defaultServerEntry(transport),
          },
        };
      });
      if (changed) {
        announce("MCP server added to draft");
      }
      return changed;
    },
    [announce, setAppError, stageScopeDraft]
  );

  const handleAttachSkill = React.useCallback(
    (targetPath: string, skillPath: string): boolean => {
      const changed = stageScopeDraft(targetPath, (current) => {
        const currentSkills = current.persona?.skills ?? [];
        const nextSkills = currentSkills.includes(skillPath)
          ? currentSkills
          : [...currentSkills, skillPath];
        return {
          ...current,
          persona: {
            ...current.persona,
            skills: nextSkills,
          },
        };
      });
      if (changed) {
        announce("Skill attached to draft");
      }
      return changed;
    },
    [announce, stageScopeDraft]
  );

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

  const handleLaunch = React.useCallback(async () => {
    if (!cwd || !selectedRole || !selectedAuthId) {
      setAppError("Select a working directory, role, and Claude credential before launching.");
      return;
    }
    const bridge = window.myclaude?.sessions;
    if (!bridge?.launch) {
      setAppError("Session launch bridge is unavailable.");
      return;
    }

    setLaunching(true);
    setAppError(null);
    try {
      const result = await bridge.launch({
        role: selectedRole,
        authProfileId: selectedAuthId,
        cwd,
      });
      setActiveTerminalSessionId(result.sessionId);
      setCurrentScreen("sessions");
      announce("Claude session launched");
    } catch (error) {
      const message = getErrorMessage(error);
      setAppError(message);
      announce(`Launch failed: ${message}`);
    } finally {
      setLaunching(false);
    }
  }, [
    announce,
    cwd,
    selectedAuthId,
    selectedRole,
    setActiveTerminalSessionId,
    setAppError,
    setCurrentScreen,
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
  const selectedAuth = authProfiles.find((profile) => profile.id === selectedAuthId);
  const selectedAuthLabel = selectedAuth?.displayName || selectedAuth?.id || selectedAuthId || "—";
  const mcpCount = Object.keys(previewEffective?.mcpServers ?? {}).length;
  const envCount = Object.keys(previewEffective?.env ?? {}).length;
  const settingsCount = Object.keys(previewEffective?.settings ?? {}).length;
  const skillCount = previewEffective?.persona.skills.length ?? 0;
  const personaCount = Object.values(previewEffective?.persona ?? {}).reduce(
    (sum, paths) => sum + paths.length,
    0
  );
  const launchReady = Boolean(cwd && selectedRole && selectedAuthId);
  const writableLayerOptions = scopeEntries
    .filter((entry) => entry.content)
    .map((entry) => ({
      value: entry.path,
      label: entry.role !== "—" ? `${entry.scope} / ${entry.role}` : entry.scope,
    }));

  return (
    <ScreenSurface
      aria-busy={
        isBootstrapping ||
        isRefreshing ||
        isSaving ||
        launching ||
        validationState.status === "loading" ||
        previewState.status === "loading"
      }
    >
      <ScreenHeader
        description={`${selectedRole || "No role"} · ${selectedAuthLabel} · ${version ?? "loading"}`}
        status={isRefreshing ? "Refreshing" : isBootstrapping ? "Bootstrapping" : "Ready"}
        title="Profile Workspace"
      >
        <div className="grid grid-cols-1 gap-4 window-large:grid-cols-[1.1fr_1fr_1fr]">
          <WorkingDirectoryDropdown
            cwd={cwd}
            onBrowse={() => void handlePickDirectory()}
            onChange={setCwd}
            recentCwds={recentCwds}
            workspaceCandidates={workspaceCandidates}
          />
          <RoleDropdown
            availableRoles={availableRoles}
            onCreateLayer={() => setCreateScopeOpen(true)}
            onManageLayer={() => selectLayerForRole(selectedRole)}
            onRoleChange={setSelectedRole}
            selectedRole={selectedRole}
          />
          <CredentialDropdown
            authProfiles={authProfiles}
            onCredentialChange={setSelectedAuthId}
            onManageCredentials={() => setCurrentScreen("auth-vault")}
            selectedAuthId={selectedAuthId}
          />
        </div>

        <div className="mt-5">
          <ActionBanner
            description={
              launchReady
                ? "Your profile context is configured and ready."
                : "Choose a role, Claude credential, and workspace before launching."
            }
            icon={Rocket}
            ready={launchReady}
            title={launchReady ? "Ready to launch" : "Select context to launch"}
            chips={
              <>
                <StatusChip tone={selectedAuthId ? "success" : "warning"}>
                  {selectedAuthId ? "Claude credential selected" : "No Claude credential"}
                </StatusChip>
                <StatusChip tone={mcpCount > 0 ? "info" : "neutral"}>
                  {mcpCount} MCP servers
                </StatusChip>
                <StatusChip tone={validationState.issues.length === 0 ? "success" : "warning"}>
                  {validationState.issues.length === 0 ? "No validation issues" : "Needs review"}
                </StatusChip>
              </>
            }
            actions={
              <>
                <Button
                  disabled={isRefreshing || !cwd}
                  onClick={() => void refreshData(cwd, selectedRole, selectedAuthId, true)}
                  type="button"
                  variant="secondary"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Refresh
                </Button>
                <Button
                  disabled={!launchReady || launching}
                  onClick={() => void handleLaunch()}
                  type="button"
                  variant="primary"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {launching ? "Launching" : "Launch Claude"}
                </Button>
              </>
            }
          />
        </div>
        {appError ? (
          <div className="mt-4 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
            {appError}
          </div>
        ) : null}
      </ScreenHeader>

      <div className="app-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-w-0 px-6 py-5">
          <div className="grid gap-4 window-medium:grid-cols-2 window-large:grid-cols-4">
            <IconTile
              icon={Database}
              label="MCP Servers"
              value={mcpCount}
              detail="Manage"
              onClick={() => setAddMcpOpen(true)}
            />
            <IconTile
              icon={Variable}
              label="Env Vars"
              value={envCount}
              detail="Configured"
              onClick={() => setWorkspaceTab("layers")}
            />
            <IconTile
              icon={Settings2}
              label="Settings"
              value={settingsCount}
              detail="Applied"
              onClick={() => setWorkspaceTab("layers")}
            />
            <IconTile
              icon={FileStack}
              label="Skills & Persona"
              value={personaCount}
              detail={`${skillCount} skills`}
              onClick={() => setSkillsCatalogOpen(true)}
            />
          </div>

          <div className="mt-4 border-b border-default">
            <div className="flex gap-2">
              <ProfileTabButton
                active={workspaceTab === "overview"}
                onClick={() => setWorkspaceTab("overview")}
              >
                Overview
              </ProfileTabButton>
              <ProfileTabButton
                active={workspaceTab === "layers"}
                onClick={() => setWorkspaceTab("layers")}
              >
                Layers
              </ProfileTabButton>
              <ProfileTabButton
                active={workspaceTab === "debug"}
                onClick={() => setWorkspaceTab("debug")}
              >
                Debug
              </ProfileTabButton>
            </div>
          </div>

          {workspaceTab === "overview" ? (
            <section className="mt-4 grid min-w-0 gap-4 window-large:grid-cols-2">
              <InfoPanel icon={ListChecks} title="Launch readiness">
                <dl className="mt-3 grid gap-3 text-sm">
                  <ReadinessRow
                    label="Claude credential"
                    value={selectedAuthLabel}
                    ok={!!selectedAuthId}
                  />
                  <ReadinessRow
                    label="Working directory"
                    value={cwd || "Not selected"}
                    ok={!!cwd}
                  />
                  <ReadinessRow
                    label="Role"
                    value={selectedRole || "Not selected"}
                    ok={!!selectedRole}
                  />
                  <ReadinessRow
                    label="Validation"
                    value={
                      validationState.issues.length === 0
                        ? "No issues"
                        : `${validationState.issues.length} issues`
                    }
                    ok={validationState.issues.length === 0}
                  />
                </dl>
              </InfoPanel>

              <InfoPanel icon={ClipboardList} title="Effective profile summary">
                <dl className="mt-3 grid gap-3 text-sm">
                  <SummaryRow label="Resolved role" value={selectedRole || "—"} />
                  <SummaryRow label="Claude credential" value={selectedAuthLabel} />
                  <SummaryRow label="Workspace" value={cwd || "—"} />
                  <SummaryRow label="Selected layer" value={selectedScopeLabel} />
                </dl>
              </InfoPanel>

              <InfoPanel icon={Layers} title="Included layers">
                {scopeEntries.length === 0 ? (
                  <p className="mt-3 text-sm text-secondary">No scope layers found.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-subtle text-sm">
                    {scopeEntries.slice(0, 8).map((entry) => (
                      <li
                        className="flex min-w-0 items-center justify-between gap-3 py-2"
                        key={entry.path}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-primary">
                            {entry.role !== "—" ? `${entry.scope} / ${entry.role}` : entry.scope}
                          </p>
                          <p className="truncate font-mono text-xs text-secondary">{entry.path}</p>
                        </div>
                        <span className="shrink-0 rounded border border-status-success bg-status-success-soft px-2 py-1 text-xs text-status-success">
                          Included
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </InfoPanel>

              <InfoPanel icon={TerminalSquare} title="Next actions">
                <div className="grid gap-3 text-sm text-secondary">
                  <p>Launch Claude, manage sessions, or add assets to a writable layer draft.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!launchReady || launching}
                      onClick={() => void handleLaunch()}
                      type="button"
                      variant="primary"
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      Launch Claude
                    </Button>
                    <Button
                      onClick={() => setCurrentScreen("sessions")}
                      type="button"
                      variant="secondary"
                    >
                      Open Sessions
                    </Button>
                    <Button
                      onClick={() => setCreateScopeOpen(true)}
                      type="button"
                      variant="secondary"
                    >
                      <FolderPlus className="h-4 w-4" aria-hidden="true" />
                      New role/layer
                    </Button>
                    <Button onClick={() => setAddMcpOpen(true)} type="button" variant="secondary">
                      <Server className="h-4 w-4" aria-hidden="true" />
                      Add MCP server
                    </Button>
                    <Button
                      onClick={() => setSkillsCatalogOpen(true)}
                      type="button"
                      variant="secondary"
                    >
                      <PackagePlus className="h-4 w-4" aria-hidden="true" />
                      Add Skill
                    </Button>
                  </div>
                </div>
              </InfoPanel>
            </section>
          ) : null}

          {workspaceTab === "layers" ? (
            <section className="mt-4 grid min-h-[36rem] min-w-0 grid-cols-1 overflow-hidden rounded-md border border-default bg-surface window-medium:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="app-scrollbar min-h-0 min-w-0 overflow-auto border-b border-default bg-surface window-medium:border-r window-medium:border-b-0">
                <div className="border-b border-subtle px-4 py-3">
                  <h2 className="text-base font-semibold text-primary">Scope layers</h2>
                  <p className="mt-1 text-sm text-secondary">
                    {selectedRole || "—"} · {scopeEntries.length} layers
                  </p>
                </div>
                <ScopeTree
                  entries={scopeEntries}
                  onSelect={setSelectedScopePath}
                  selectedPath={selectedScopePath}
                />
              </aside>

              <div className="grid min-h-0 min-w-0 grid-cols-1 window-large:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
                <div
                  className="app-scrollbar min-h-0 min-w-0 overflow-auto border-b border-default bg-subtle window-large:border-r window-large:border-b-0"
                  ref={previewPaneRef}
                >
                  <div className="border-b border-subtle px-4 py-3">
                    <h2 className="text-base font-semibold text-primary">Effective preview</h2>
                    <p className="mt-1 text-sm text-secondary">
                      {selectedRole || "—"} · {selectedAuthLabel}
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
                        {previewState.diff.slice(0, 12).map((item) => (
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
                              <span className="font-mono text-xs text-secondary">
                                - {item.before}
                              </span>
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

                <div className="app-scrollbar min-h-0 min-w-0 overflow-auto bg-surface">
                  <div className="border-b border-subtle px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-primary">Editor</h2>
                        <p className="mt-1 truncate text-sm text-secondary">
                          {selectedScopeLabel}
                          {selectedScope ? ` · ${selectedScope.path}` : ""}
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
                      <p className="mt-2 text-sm text-status-danger">
                        {validationState.errorMessage}
                      </p>
                    ) : null}

                    {validationState.issues.length > 0 ||
                    settingsParseError ||
                    jsonState.parseError ? (
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
                    <div className="h-[34rem] p-4">
                      <CodeEditor
                        ariaLabel="Profile JSON editor"
                        height="100%"
                        onChange={updateJsonMode}
                        value={jsonState.text}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {workspaceTab === "debug" ? (
            <section className="mt-4 min-w-0 overflow-hidden rounded-md border border-default bg-surface">
              <div className="border-b border-subtle px-4 pt-3">
                <div className="flex gap-2">
                  <ProfileTabButton
                    active={debugTab === "provenance"}
                    onClick={() => setDebugTab("provenance")}
                  >
                    Provenance
                  </ProfileTabButton>
                  <ProfileTabButton
                    active={debugTab === "persona"}
                    onClick={() => setDebugTab("persona")}
                  >
                    Persona
                  </ProfileTabButton>
                </div>
              </div>
              <div className="h-[42rem] min-h-0">
                {debugTab === "provenance" ? (
                  <ProvenanceInspectorScreen embedded />
                ) : (
                  <PersonaComposerScreen embedded />
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <CreateScopeDialog
        defaultRole={selectedRole}
        onCreate={(input) => void handleCreateScope(input)}
        onOpenChange={setCreateScopeOpen}
        open={createScopeOpen}
      />
      <AddMcpServerDialog
        defaultTargetPath={selectedScopePath ?? writableLayerOptions[0]?.value ?? ""}
        layerOptions={writableLayerOptions}
        onAdd={handleAddMcpServer}
        onCreateLayer={() => setCreateScopeOpen(true)}
        onOpenChange={setAddMcpOpen}
        open={addMcpOpen}
      />
      <SkillsCatalogDialog
        defaultTargetPath={selectedScopePath ?? writableLayerOptions[0]?.value ?? ""}
        layerOptions={writableLayerOptions}
        onAttachSkill={handleAttachSkill}
        onCreateLayer={() => setCreateScopeOpen(true)}
        onOpenChange={setSkillsCatalogOpen}
        open={skillsCatalogOpen}
      />
    </ScreenSurface>
  );
}

function ContextDropdown({
  children,
  icon: Icon,
  label,
  value,
}: {
  children: React.ReactNode;
  icon: typeof FolderOpen;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="group flex h-[3.75rem] min-w-0 items-center gap-3 rounded-md border border-default bg-canvas px-4 text-left shadow-xs transition-colors hover:border-accent hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-default bg-surface text-secondary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium uppercase tracking-normal text-tertiary">
              {label}
            </span>
            <span className="mt-1 block truncate text-sm font-medium text-primary">{value}</span>
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-tertiary transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(34rem,calc(100vw-3rem))]">{children}</PopoverContent>
    </Popover>
  );
}

function WorkingDirectoryDropdown({
  cwd,
  onBrowse,
  onChange,
  recentCwds,
  workspaceCandidates,
}: {
  cwd: string;
  onBrowse: () => void;
  onChange: (value: string) => void;
  recentCwds: string[];
  workspaceCandidates: WorkspaceCandidateOption[];
}): React.ReactElement {
  const [draft, setDraft] = React.useState(cwd);
  React.useEffect(() => setDraft(cwd), [cwd]);

  return (
    <ContextDropdown icon={FolderOpen} label="Working directory" value={cwd || "Choose workspace"}>
      <div className="grid gap-3">
        <Field label="Workspace path">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              aria-label="Working directory path"
              className="bg-canvas"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setDraft(event.target.value)
              }
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") onChange(draft);
              }}
              value={draft}
            />
            <Button onClick={onBrowse} type="button" variant="secondary">
              Browse
            </Button>
          </div>
        </Field>
        <div className="flex justify-end">
          <PopoverClose asChild>
            <Button disabled={!draft.trim()} onClick={() => onChange(draft.trim())} type="button">
              Apply
            </Button>
          </PopoverClose>
        </div>
        {workspaceCandidates.length > 0 ? (
          <div className="border-t border-subtle pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-normal text-tertiary">
              Detected workspaces
            </p>
            <div className="grid gap-1">
              {workspaceCandidates.map((candidate) => {
                const label = candidate.kind === "root" ? "Root" : "Package";
                const detail =
                  candidate.kind === "package" && candidate.packageName
                    ? candidate.packageName
                    : candidate.marker;
                return (
                  <PopoverClose asChild key={candidate.path}>
                    <button
                      className={cn(
                        "min-w-0 rounded-md px-2 py-2 text-left text-sm text-secondary hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        candidate.path === cwd && "bg-elevated text-primary"
                      )}
                      onClick={() => onChange(candidate.path)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-xs font-medium text-primary">{label}</span>
                        {detail ? (
                          <span className="truncate text-xs text-tertiary">{detail}</span>
                        ) : null}
                        {candidate.hasMyClaude ? (
                          <span className="ml-auto shrink-0 rounded-sm border border-subtle px-1.5 py-0.5 font-mono text-[0.65rem] text-tertiary">
                            .myclaude
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs">
                        {candidate.path}
                      </span>
                    </button>
                  </PopoverClose>
                );
              })}
            </div>
          </div>
        ) : null}
        {recentCwds.length > 0 ? (
          <div className="border-t border-subtle pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-normal text-tertiary">
              Recent workspaces
            </p>
            <div className="grid gap-1">
              {recentCwds.map((path) => (
                <PopoverClose asChild key={path}>
                  <button
                    className="min-w-0 rounded-md px-2 py-2 text-left text-sm text-secondary hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onChange(path)}
                    type="button"
                  >
                    <span className="block truncate font-mono text-xs">{path}</span>
                  </button>
                </PopoverClose>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </ContextDropdown>
  );
}

function RoleDropdown({
  availableRoles,
  onCreateLayer,
  onManageLayer,
  onRoleChange,
  selectedRole,
}: {
  availableRoles: string[];
  onCreateLayer: () => void;
  onManageLayer: () => void;
  onRoleChange: (value: string) => void;
  selectedRole: string;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const filteredRoles = availableRoles.filter((role) =>
    role.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <ContextDropdown icon={UserRound} label="Role" value={selectedRole || "Select role"}>
      <div className="grid gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
          <Input
            aria-label="Search roles"
            className="bg-canvas pl-9"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder="Search roles"
            value={query}
          />
        </div>
        <div className="max-h-56 overflow-auto rounded-md border border-subtle">
          {filteredRoles.length > 0 ? (
            filteredRoles.map((role) => (
              <PopoverClose asChild key={role}>
                <button
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    role === selectedRole ? "bg-accent-soft text-primary" : "text-secondary"
                  )}
                  onClick={() => onRoleChange(role)}
                  type="button"
                >
                  <span className="truncate font-medium">{role}</span>
                  {role === selectedRole ? (
                    <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden="true" />
                  ) : null}
                </button>
              </PopoverClose>
            ))
          ) : (
            <p className="px-3 py-4 text-sm text-secondary">No roles found.</p>
          )}
        </div>
        <div className="grid gap-2 border-t border-subtle pt-3 sm:grid-cols-2">
          <PopoverClose asChild>
            <Button onClick={onCreateLayer} type="button" variant="primary">
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              New role/layer
            </Button>
          </PopoverClose>
          <PopoverClose asChild>
            <Button
              disabled={!selectedRole}
              onClick={onManageLayer}
              type="button"
              variant="secondary"
            >
              <Layers className="h-4 w-4" aria-hidden="true" />
              Manage selected
            </Button>
          </PopoverClose>
        </div>
      </div>
    </ContextDropdown>
  );
}

function CredentialDropdown({
  authProfiles,
  onCredentialChange,
  onManageCredentials,
  selectedAuthId,
}: {
  authProfiles: Array<{ id: string; displayName: string; mode: string }>;
  onCredentialChange: (value: string) => void;
  onManageCredentials: () => void;
  selectedAuthId: string;
}): React.ReactElement {
  const selected = authProfiles.find((profile) => profile.id === selectedAuthId);
  const value = selected
    ? `${selected.displayName || selected.id} (${selected.mode})`
    : "Connect Claude";

  return (
    <ContextDropdown icon={KeyRound} label="Claude credential" value={value}>
      <div className="grid gap-3">
        <div className="max-h-64 overflow-auto rounded-md border border-subtle">
          {authProfiles.length > 0 ? (
            authProfiles.map((profile) => (
              <PopoverClose asChild key={profile.id}>
                <button
                  className={cn(
                    "flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    profile.id === selectedAuthId ? "bg-accent-soft" : ""
                  )}
                  onClick={() => onCredentialChange(profile.id)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-primary">
                      {profile.displayName || profile.id}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-secondary">
                      {profile.mode}
                    </span>
                  </span>
                  {profile.id === selectedAuthId ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
                  ) : null}
                </button>
              </PopoverClose>
            ))
          ) : (
            <p className="px-3 py-4 text-sm text-secondary">No Claude credentials found.</p>
          )}
        </div>
        <PopoverClose asChild>
          <Button onClick={onManageCredentials} type="button" variant="primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {authProfiles.length > 0 ? "Manage credentials" : "Connect Claude"}
          </Button>
        </PopoverClose>
      </div>
    </ContextDropdown>
  );
}

function CreateScopeDialog({
  defaultRole,
  onCreate,
  onOpenChange,
  open,
}: {
  defaultRole: string;
  onCreate: (input: {
    location: "global" | "project";
    layerType: "shared" | "role";
    role?: string;
  }) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): React.ReactElement {
  const [location, setLocation] = React.useState<"global" | "project">("project");
  const [layerType, setLayerType] = React.useState<"shared" | "role">("role");
  const [role, setRole] = React.useState(defaultRole);

  React.useEffect(() => {
    if (open) setRole(defaultRole);
  }, [defaultRole, open]);

  const roleValid = layerType === "shared" || Boolean(normalizeConfigName(role));

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New role/layer</DialogTitle>
          <DialogDescription>
            Create the YAML scope that will hold MCP servers, skills, env, and settings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Location">
            <Select
              aria-label="Layer location"
              onValueChange={(value) => setLocation(value as "global" | "project")}
              options={[
                { value: "project", label: "Project" },
                { value: "global", label: "Global" },
              ]}
              value={location}
            />
          </Field>
          <Field label="Layer type">
            <Select
              aria-label="Layer type"
              onValueChange={(value) => setLayerType(value as "shared" | "role")}
              options={[
                { value: "role", label: "Role-specific" },
                { value: "shared", label: "Shared" },
              ]}
              value={layerType}
            />
          </Field>
          {layerType === "role" ? (
            <Field
              {...(!roleValid ? { error: "Use lowercase letters, numbers, _ or -." } : {})}
              label="Role name"
            >
              <Input
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setRole(event.target.value)
                }
                placeholder="backend"
                value={role}
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={!roleValid}
            onClick={() => {
              onOpenChange(false);
              onCreate({
                location,
                layerType,
                ...(layerType === "role" ? { role: normalizeConfigName(role) } : {}),
              });
            }}
            type="button"
          >
            Create layer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMcpServerDialog({
  defaultTargetPath,
  layerOptions,
  onAdd,
  onCreateLayer,
  onOpenChange,
  open,
}: {
  defaultTargetPath: string;
  layerOptions: Array<{ value: string; label: string }>;
  onAdd: (
    targetPath: string,
    name: string,
    transport: "stdio" | "http" | "streamable-http" | "sse"
  ) => boolean;
  onCreateLayer: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): React.ReactElement {
  const [targetPath, setTargetPath] = React.useState(defaultTargetPath);
  const [name, setName] = React.useState("server");
  const [transport, setTransport] = React.useState<"stdio" | "http" | "streamable-http" | "sse">(
    "stdio"
  );

  React.useEffect(() => {
    if (open) setTargetPath(defaultTargetPath);
  }, [defaultTargetPath, open]);

  const canAdd = Boolean(targetPath && normalizeConfigName(name));

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Add a server stub to a layer draft, then finish the server fields in Layers.
          </DialogDescription>
        </DialogHeader>
        {layerOptions.length === 0 ? (
          <div className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-3 text-sm text-status-warning">
            No writable layer exists yet. Create a project or global layer first.
          </div>
        ) : (
          <div className="grid gap-4">
            <Field label="Target layer">
              <Select
                aria-label="MCP target layer"
                onValueChange={setTargetPath}
                options={layerOptions}
                value={targetPath}
              />
            </Field>
            <Field label="Server name">
              <Input
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setName(event.target.value)
                }
                placeholder="linear"
                value={name}
              />
            </Field>
            <Field label="Transport">
              <Select
                aria-label="MCP transport"
                onValueChange={(value) =>
                  setTransport(value as "stdio" | "http" | "streamable-http" | "sse")
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
        )}
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
              onCreateLayer();
            }}
            type="button"
            variant="secondary"
          >
            New layer
          </Button>
          <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={!canAdd}
            onClick={() => {
              if (onAdd(targetPath, name, transport)) onOpenChange(false);
            }}
            type="button"
          >
            Add to draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillsCatalogDialog({
  defaultTargetPath,
  layerOptions,
  onAttachSkill,
  onCreateLayer,
  onOpenChange,
  open,
}: {
  defaultTargetPath: string;
  layerOptions: Array<{ value: string; label: string }>;
  onAttachSkill: (targetPath: string, skillPath: string) => boolean;
  onCreateLayer: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): React.ReactElement {
  const [targetPath, setTargetPath] = React.useState(defaultTargetPath);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SkillCatalogItem[]>([]);
  const [selectedSkill, setSelectedSkill] = React.useState<SkillCatalogItem | null>(null);
  const [detailSummary, setDetailSummary] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setTargetPath(defaultTargetPath);
  }, [defaultTargetPath, open]);

  React.useEffect(() => {
    if (!open || !selectedSkill) {
      setDetailSummary(null);
      return;
    }
    let cancelled = false;
    const api = window.myclaude?.skills;
    if (!api?.detail || !api.audit) return;
    void Promise.allSettled([
      api.detail({ id: selectedSkill.id }),
      api.audit({ id: selectedSkill.id }),
    ])
      .then(([detail, audit]) => {
        if (cancelled) return;
        const summary = summarizeSkillDetail(
          detail.status === "fulfilled" ? detail.value : null,
          audit.status === "fulfilled" ? audit.value : null
        );
        setDetailSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setDetailSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedSkill]);

  const search = React.useCallback(async () => {
    const api = window.myclaude?.skills;
    if (!api?.search) {
      setError("Renderer bridge is incomplete. Waiting for skills.search.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.search({ query, limit: 20 });
      setResults(response.skills);
      setSelectedSkill(response.skills[0] ?? null);
    } catch (searchError) {
      setError(getErrorMessage(searchError));
    } finally {
      setLoading(false);
    }
  }, [query]);

  const installSelected = React.useCallback(async () => {
    if (!selectedSkill || !targetPath) return;
    const api = window.myclaude?.skills;
    if (!api?.install) {
      setError("Renderer bridge is incomplete. Waiting for skills.install.");
      return;
    }
    setInstalling(true);
    setError(null);
    try {
      const result = await api.install({
        id: selectedSkill.id,
        slug: selectedSkill.slug,
        source: selectedSkill.source,
        ...(selectedSkill.installUrl ? { installUrl: selectedSkill.installUrl } : {}),
      });
      if (onAttachSkill(targetPath, result.path)) onOpenChange(false);
    } catch (installError) {
      setError(getErrorMessage(installError));
    } finally {
      setInstalling(false);
    }
  }, [onAttachSkill, onOpenChange, selectedSkill, targetPath]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add Skill</DialogTitle>
          <DialogDescription>
            Search skills.sh, install globally for Claude Code, then attach the installed skill path
            to a profile layer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {layerOptions.length === 0 ? (
            <div className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-3 text-sm text-status-warning">
              Create a writable layer before attaching skills.
            </div>
          ) : (
            <Field label="Target layer">
              <Select
                aria-label="Skill target layer"
                onValueChange={setTargetPath}
                options={layerOptions}
                value={targetPath}
              />
            </Field>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              aria-label="Search skills.sh"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") void search();
              }}
              placeholder="Search skills.sh"
              value={query}
            />
            <Button disabled={loading} onClick={() => void search()} type="button">
              <Search className="h-4 w-4" aria-hidden="true" />
              {loading ? "Searching" : "Search"}
            </Button>
          </div>

          {error ? (
            <div className="rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
              {error}
            </div>
          ) : null}

          <div className="grid min-h-[18rem] gap-4 window-medium:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-h-0 overflow-auto rounded-md border border-default">
              {results.length > 0 ? (
                results.map((skill) => (
                  <button
                    className={cn(
                      "grid w-full gap-1 border-b border-subtle px-3 py-3 text-left last:border-b-0 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedSkill?.id === skill.id ? "bg-accent-soft" : ""
                    )}
                    key={skill.id}
                    onClick={() => setSelectedSkill(skill)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-primary">
                        {skill.name}
                      </span>
                      {skill.duplicate ? (
                        <span className="shrink-0 rounded border border-status-warning bg-status-warning-soft px-2 py-0.5 text-xs text-status-warning">
                          duplicate
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-secondary">{skill.source}</span>
                    {skill.description ? (
                      <span className="line-clamp-2 text-sm text-secondary">
                        {skill.description}
                      </span>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="flex h-full min-h-[18rem] items-center justify-center px-6 text-center text-sm text-secondary">
                  Search for a skill to install.
                </div>
              )}
            </div>

            <aside className="rounded-md border border-default bg-subtle p-3">
              {selectedSkill ? (
                <div className="grid gap-3 text-sm">
                  <div>
                    <h3 className="font-semibold text-primary">{selectedSkill.name}</h3>
                    <p className="mt-1 break-all font-mono text-xs text-secondary">
                      {selectedSkill.slug}
                    </p>
                  </div>
                  <SkillMetaRow label="Source" value={selectedSkill.source} />
                  {selectedSkill.installs !== undefined ? (
                    <SkillMetaRow label="Installs" value={String(selectedSkill.installs)} />
                  ) : null}
                  {selectedSkill.auditStatus ? (
                    <SkillMetaRow label="Audit" value={selectedSkill.auditStatus} />
                  ) : null}
                  {detailSummary ? <SkillMetaRow label="Details" value={detailSummary} /> : null}
                  {selectedSkill.url ? (
                    <a
                      className="inline-flex items-center gap-2 text-sm text-status-info hover:underline"
                      href={selectedSkill.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open skills.sh
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-secondary">No skill selected.</p>
              )}
            </aside>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
              onCreateLayer();
            }}
            type="button"
            variant="secondary"
          >
            New layer
          </Button>
          <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={!selectedSkill || !targetPath || installing}
            onClick={() => void installSelected()}
            type="button"
          >
            <PackagePlus className="h-4 w-4" aria-hidden="true" />
            {installing ? "Installing" : "Install & attach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillMetaRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-normal text-tertiary">{label}</span>
      <span className="break-words text-sm text-primary">{value}</span>
    </div>
  );
}

function ProfileTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      className={cn(
        "border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-accent text-status-info"
          : "border-transparent text-secondary hover:text-primary"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ReadinessRow({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-2 text-secondary">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden="true" />
        ) : (
          <CircleAlert className="h-4 w-4 text-status-warning" aria-hidden="true" />
        )}
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-primary">{value}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-xs text-primary">{value}</dd>
    </div>
  );
}

const RECENT_CWDS_KEY = "agent-profile.recent-cwds";
const CONFIG_NAME_RE = /^[a-z0-9_-]+$/;

function loadRecentCwds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_CWDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function storeRecentCwd(cwd: string, current: string[]): string[] {
  const next = [cwd, ...current.filter((candidate) => candidate !== cwd)].slice(0, 5);
  try {
    window.localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify(next));
  } catch {
    // Best-effort UX cache only.
  }
  return next;
}

function normalizeConfigName(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/\s+/g, "-");
  return CONFIG_NAME_RE.test(normalized) ? normalized : "";
}

function uniqueMcpServerName(servers: Record<string, unknown>, preferredName: string): string {
  let candidate = preferredName;
  let index = 2;
  while (candidate in servers) {
    candidate = `${preferredName}-${index}`;
    index += 1;
  }
  return candidate;
}

function summarizeSkillDetail(detail: unknown, audit: unknown): string | null {
  const auditStatus = readStringPath(audit, ["status"]) ?? readStringPath(audit, ["auditStatus"]);
  const description =
    readStringPath(detail, ["description"]) ??
    readStringPath(detail, ["summary"]) ??
    readStringPath(detail, ["skill", "description"]);
  if (auditStatus && description) return `${auditStatus} · ${description}`;
  return auditStatus ?? description ?? null;
}

function readStringPath(value: unknown, path: string[]): string | null {
  let cursor = value;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
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

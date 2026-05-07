import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
} from "@agent-profile/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  AlertTriangle,
  ArrowRight,
  FolderOpen,
  KeyRound,
  type LucideIcon,
  Plus,
  Rocket,
  Sparkles,
  Wrench,
} from "lucide-react";
import * as React from "react";
import { AgentProfileSidePanel } from "../components/agent-profile-side-panel.js";
import { useAnnounce } from "../components/live-announcer.js";
import { ProfileBasicsPanel } from "../components/profile-basics-panel.js";
import { ProfileMcpToolsPanel } from "../components/profile-mcp-tools-panel.js";
import { ProfileSkillsPersonaPanel } from "../components/profile-skills-persona-panel.js";
import { ProfileUnsavedChangesDialog } from "../components/profile-unsaved-dialog.js";
import { IconFrame, ScreenHeader, ScreenSurface, StatusChip } from "../components/screen-ui.js";
import {
  type AgentProfileLibraryItem,
  agentProfileLibraryAtom,
  agentProfileViewModelAtom,
} from "../lib/agent-profile-view-model.js";
import {
  type ProfileWorkspaceTab,
  activeTerminalSessionIdAtom,
  agentProfilePanelSectionAtom,
  authProfilesAtom,
  authVaultFocusRequestAtom,
  availableRolesAtom,
  currentScreenAtom,
  cwdAtom,
  effectiveStateAtom,
  previewStateAtom,
  profileWorkspaceTabAtom,
  scopeEntriesAtom,
  selectedAgentProfilePanelIdAtom,
  selectedAuthIdAtom,
  selectedRoleAtom,
  selectedScopePathAtom,
  validationStateAtom,
} from "../lib/atoms.js";
import {
  collectRoles,
  getErrorMessage,
  normalizeEffectiveState,
  normalizeScopeList,
} from "../lib/normalize.js";
import {
  formatProfileBasicsBridgeError,
  resolveProfileBasicsReloadSelection,
  resolveProfileBasicsReloadState,
} from "../lib/profile-basics.js";
import {
  type ProfileCreationDraft,
  type ProfileCreationField,
  type ProfileCreationResolvedDraft,
  type ProfileCreationValidationIssue,
  buildProfileCreateScopePayload,
  buildProfileSelection,
  deriveProfileRoleSlug,
  formatProfileCreateError,
  validateProfileCreationDraft,
  writeProfileSelection,
} from "../lib/profile-creation.js";
import { useProfileDraftNavigationGuard } from "../lib/profile-draft-guard.js";
import type { AuthProfileOption } from "../lib/types.js";

export function AgentProfilesHomeScreen(): React.ReactElement {
  const agentProfile = useAtomValue(agentProfileViewModelAtom);
  const effectiveState = useAtomValue(effectiveStateAtom);
  const profileLibrary = useAtomValue(agentProfileLibraryAtom);
  const authProfiles = useAtomValue(authProfilesAtom);
  const scopeEntries = useAtomValue(scopeEntriesAtom);
  const [availableRoles, setAvailableRoles] = useAtom(availableRolesAtom);
  const [cwd, setCwd] = useAtom(cwdAtom);
  const [selectedPanelProfileId, setSelectedPanelProfileId] = useAtom(
    selectedAgentProfilePanelIdAtom
  );
  const [panelSection, setPanelSection] = useAtom(agentProfilePanelSectionAtom);
  const setActiveTerminalSessionId = useSetAtom(activeTerminalSessionIdAtom);
  const setAuthVaultFocusRequest = useSetAtom(authVaultFocusRequestAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const setProfileWorkspaceTab = useSetAtom(profileWorkspaceTabAtom);
  const setScopeEntries = useSetAtom(scopeEntriesAtom);
  const setSelectedRole = useSetAtom(selectedRoleAtom);
  const setSelectedAuthId = useSetAtom(selectedAuthIdAtom);
  const setSelectedScopePath = useSetAtom(selectedScopePathAtom);
  const setEffectiveState = useSetAtom(effectiveStateAtom);
  const setValidationState = useSetAtom(validationStateAtom);
  const setPreviewState = useSetAtom(previewStateAtom);
  const announce = useAnnounce();
  const draftGuard = useProfileDraftNavigationGuard({ announce });
  const latestAgentProfileRef = React.useRef(agentProfile);
  latestAgentProfileRef.current = agentProfile;
  const [isLaunching, setIsLaunching] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [basicsPanelOpen, setBasicsPanelOpen] = React.useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = React.useState(false);
  const [skillsPersonaPanelOpen, setSkillsPersonaPanelOpen] = React.useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = React.useState(false);
  const [createProfileError, setCreateProfileError] = React.useState<string | null>(null);
  const [librarySwitchError, setLibrarySwitchError] = React.useState<string | null>(null);
  const [switchingProfileId, setSwitchingProfileId] = React.useState<string | null>(null);
  const createButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const basicsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const toolsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const skillsPersonaButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const detailsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const isPanelOpenForProfile = selectedPanelProfileId === agentProfile.id;

  const openProfileDetails = React.useCallback(() => {
    setLaunchError(null);
    setPanelSection("summary");
    setSelectedPanelProfileId(agentProfile.id);
  }, [agentProfile.id, setPanelSection, setSelectedPanelProfileId]);

  const closeProfileDetails = React.useCallback(() => {
    setSelectedPanelProfileId(null);
    setPanelSection("summary");
    window.requestAnimationFrame(() => {
      detailsButtonRef.current?.focus();
    });
  }, [setPanelSection, setSelectedPanelProfileId]);

  React.useEffect(() => {
    if (!selectedPanelProfileId) return;
    if (selectedPanelProfileId !== agentProfile.id) {
      setPanelSection("summary");
    }
  }, [agentProfile.id, selectedPanelProfileId, setPanelSection]);

  const goToProfileWorkspaceTab = React.useCallback(
    (tab: ProfileWorkspaceTab) => {
      setLaunchError(null);
      setProfileWorkspaceTab(tab);
      setCurrentScreen("editor");
    },
    [setCurrentScreen, setProfileWorkspaceTab]
  );

  const openProfileWorkspaceTab = React.useCallback(
    (tab: ProfileWorkspaceTab) => {
      draftGuard.request(() => goToProfileWorkspaceTab(tab));
    },
    [draftGuard, goToProfileWorkspaceTab]
  );

  const openProfileWorkspace = React.useCallback(() => {
    openProfileWorkspaceTab("overview");
  }, [openProfileWorkspaceTab]);

  const closeCreateDialog = React.useCallback(() => {
    setCreateDialogOpen(false);
    setCreateProfileError(null);
    window.requestAnimationFrame(() => {
      createButtonRef.current?.focus();
    });
  }, []);

  const closeBasicsPanel = React.useCallback(() => {
    setBasicsPanelOpen(false);
    window.requestAnimationFrame(() => {
      basicsButtonRef.current?.focus();
    });
  }, []);

  const closeToolsPanel = React.useCallback(() => {
    setToolsPanelOpen(false);
    window.requestAnimationFrame(() => {
      toolsButtonRef.current?.focus();
    });
  }, []);

  const closeSkillsPersonaPanel = React.useCallback(() => {
    setSkillsPersonaPanelOpen(false);
    window.requestAnimationFrame(() => {
      skillsPersonaButtonRef.current?.focus();
    });
  }, []);

  const openBasicsPanel = React.useCallback(() => {
    setLaunchError(null);
    setLibrarySwitchError(null);
    setSelectedPanelProfileId(null);
    setPanelSection("summary");
    setBasicsPanelOpen(true);
  }, [setPanelSection, setSelectedPanelProfileId]);

  const openToolsPanel = React.useCallback(() => {
    setLaunchError(null);
    setLibrarySwitchError(null);
    setToolsPanelOpen(true);
  }, []);

  const openSkillsPersonaPanel = React.useCallback(() => {
    setLaunchError(null);
    setLibrarySwitchError(null);
    setSkillsPersonaPanelOpen(true);
  }, []);

  const openCreateDialog = React.useCallback(() => {
    setLaunchError(null);
    setLibrarySwitchError(null);
    setSelectedPanelProfileId(null);
    setPanelSection("summary");
    setCreateProfileError(null);
    setCreateDialogOpen(true);
  }, [setPanelSection, setSelectedPanelProfileId]);

  const goToClaudeAuth = React.useCallback(() => {
    setLaunchError(null);
    setCurrentScreen("auth-vault");
  }, [setCurrentScreen]);

  const openClaudeAuth = React.useCallback(() => {
    draftGuard.request(goToClaudeAuth);
  }, [draftGuard, goToClaudeAuth]);

  const requestToolSecretRepair = React.useCallback(
    (secretName: string) => {
      const profileId = agentProfile.auth.profileId?.trim() ?? "";
      const logicalName = secretName.trim();
      setLaunchError(null);
      setLibrarySwitchError(null);

      if (!profileId) {
        announce("Choose a Claude identity before repairing tool secrets.");
        openClaudeAuth();
        return;
      }

      if (!logicalName) {
        announce("Choose a valid logical tool secret before repairing in Auth.");
        openClaudeAuth();
        return;
      }

      draftGuard.request(() => {
        setAuthVaultFocusRequest({
          profileId,
          secretName: logicalName,
          source: "profile-tools-repair",
          nonce: Date.now(),
        });
        setSelectedAuthId(profileId);
        setSelectedPanelProfileId(null);
        setPanelSection("summary");
        setCurrentScreen("auth-vault");
      });
    },
    [
      agentProfile.auth.profileId,
      announce,
      draftGuard,
      openClaudeAuth,
      setAuthVaultFocusRequest,
      setCurrentScreen,
      setPanelSection,
      setSelectedAuthId,
      setSelectedPanelProfileId,
    ]
  );

  const handleFixPath = React.useCallback(() => {
    setLaunchError(null);
    const fixTarget =
      agentProfile.readiness.blockingReason?.fixTarget ??
      agentProfile.readiness.warnings[0]?.fixTarget;
    if (fixTarget === "identity") {
      openClaudeAuth();
      return;
    }
    if (fixTarget === "tools" || fixTarget === "skills" || fixTarget === "inspect") {
      setPanelSection(fixTarget);
      setSelectedPanelProfileId(agentProfile.id);
      return;
    }
    openProfileWorkspaceTab("overview");
  }, [
    agentProfile.id,
    agentProfile.readiness.blockingReason?.fixTarget,
    agentProfile.readiness.warnings,
    openClaudeAuth,
    openProfileWorkspaceTab,
    setPanelSection,
    setSelectedPanelProfileId,
  ]);

  const handleCreateProfile = React.useCallback(
    async (value: ProfileCreationResolvedDraft) => {
      const profileBridge = window.myclaude?.profile;
      if (!profileBridge?.createScope || !profileBridge.list || !profileBridge.show) {
        const message = "Profile creation is unavailable right now.";
        setCreateProfileError(message);
        announce(message);
        return;
      }

      const selection = buildProfileSelection(value);
      setIsCreatingProfile(true);
      setCreateProfileError(null);
      try {
        await profileBridge.createScope(buildProfileCreateScopePayload(value));
        const listed = await profileBridge.list({ cwd: selection.cwd });
        const nextScopeEntries = normalizeScopeList(listed);
        const nextRoles = collectRoles(nextScopeEntries);
        const shown = await profileBridge.show(selection);

        setCwd(selection.cwd);
        setScopeEntries(nextScopeEntries);
        setAvailableRoles(nextRoles);
        setSelectedRole(selection.role);
        setSelectedAuthId(selection.authProfileId);
        setSelectedScopePath(findScopePathForRole(nextScopeEntries, selection.role));
        setEffectiveState(normalizeEffectiveState(shown));
        setValidationState({ status: "idle", issues: [], errorMessage: null });
        setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
        writeProfileSelection(window.localStorage, selection);
        setCreateDialogOpen(false);
        setSelectedPanelProfileId(null);
        setPanelSection("summary");
        announce(`Created Agent Profile ${selection.role}`);
      } catch (error) {
        const message = formatProfileCreateError(error);
        setCreateProfileError(message);
        announce(message);
      } finally {
        setIsCreatingProfile(false);
      }
    },
    [
      announce,
      setAvailableRoles,
      setCwd,
      setEffectiveState,
      setPanelSection,
      setPreviewState,
      setScopeEntries,
      setSelectedAuthId,
      setSelectedPanelProfileId,
      setSelectedRole,
      setSelectedScopePath,
      setValidationState,
    ]
  );

  const handleBasicsSaved = React.useCallback(
    async (selection: { role: string; authProfileId: string; cwd: string }) => {
      const profileBridge = window.myclaude?.profile;
      if (!profileBridge?.list || !profileBridge.show) {
        throw new Error("Profile refresh is unavailable right now.");
      }

      try {
        const listed = await profileBridge.list({ cwd: selection.cwd });
        const reloadSelection = resolveProfileBasicsReloadSelection({
          authProfiles,
          listed,
          selection,
        });
        if (!reloadSelection.ok) {
          throw new Error(reloadSelection.message);
        }

        const shown = await profileBridge.show(reloadSelection.value.selection);
        const reloadState = resolveProfileBasicsReloadState({
          reloadSelection: reloadSelection.value,
          shown,
        });
        if (!reloadState.ok) {
          throw new Error(reloadState.message);
        }

        setCwd(reloadState.value.selection.cwd);
        setScopeEntries(reloadState.value.scopeEntries);
        setAvailableRoles(reloadState.value.availableRoles);
        setSelectedRole(reloadState.value.selection.role);
        setSelectedAuthId(reloadState.value.selection.authProfileId);
        setSelectedScopePath(reloadState.value.selectedScopePath);
        setEffectiveState(reloadState.value.effectiveState);
        setValidationState({ status: "idle", issues: [], errorMessage: null });
        setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
        writeProfileSelection(window.localStorage, reloadState.value.selection);
        setSelectedPanelProfileId(null);
        setPanelSection("summary");
      } catch (error) {
        throw new Error(
          formatProfileBasicsBridgeError(
            error,
            "Profile Basics saved, but the refreshed profile could not be loaded. The previous selection was kept."
          )
        );
      }
    },
    [
      authProfiles,
      setAvailableRoles,
      setCwd,
      setEffectiveState,
      setPanelSection,
      setPreviewState,
      setScopeEntries,
      setSelectedAuthId,
      setSelectedPanelProfileId,
      setSelectedRole,
      setSelectedScopePath,
      setValidationState,
    ]
  );

  const executeSelectProfile = React.useCallback(
    async (item: AgentProfileLibraryItem) => {
      const profileBridge = window.myclaude?.profile;
      if (!profileBridge?.show) {
        const message = "Profile switching is unavailable right now.";
        setLibrarySwitchError(message);
        announce(message);
        return;
      }

      setSwitchingProfileId(item.id);
      setLibrarySwitchError(null);
      setLaunchError(null);
      try {
        const shown = await profileBridge.show(item.selection);
        setCwd(item.selection.cwd);
        setSelectedRole(item.selection.role);
        setSelectedAuthId(item.selection.authProfileId);
        setSelectedScopePath(findScopePathForRole(scopeEntries, item.selection.role));
        setEffectiveState(normalizeEffectiveState(shown));
        setValidationState({ status: "idle", issues: [], errorMessage: null });
        setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
        writeProfileSelection(window.localStorage, item.selection);
        setSelectedPanelProfileId(null);
        setPanelSection("summary");
        announce(`Switched to Agent Profile ${item.displayName}`);
      } catch (error) {
        const message = formatProfileSwitchError(error);
        setLibrarySwitchError(message);
        announce(message);
      } finally {
        setSwitchingProfileId(null);
      }
    },
    [
      announce,
      scopeEntries,
      setCwd,
      setEffectiveState,
      setPanelSection,
      setPreviewState,
      setSelectedAuthId,
      setSelectedPanelProfileId,
      setSelectedRole,
      setSelectedScopePath,
      setValidationState,
    ]
  );

  const handleSelectProfile = React.useCallback(
    (item: AgentProfileLibraryItem, returnFocusTo?: HTMLElement | null) => {
      if (item.isSelected) {
        setLibrarySwitchError(null);
        return;
      }
      if (!item.isSwitchable) {
        const message =
          item.disabledReason ?? "This Agent Profile needs attention before it can be selected.";
        setLibrarySwitchError(message);
        announce(message);
        return;
      }

      draftGuard.request(
        () => {
          void executeSelectProfile(item);
        },
        { returnFocusTo }
      );
    },
    [announce, draftGuard, executeSelectProfile]
  );

  const executeLaunch = React.useCallback(async () => {
    const currentAgentProfile = latestAgentProfileRef.current;
    const launchPayload = currentAgentProfile.launch.payload;
    if (!launchPayload) {
      const message =
        currentAgentProfile.launch.disabledReason ?? "Profile is not ready to launch.";
      setLaunchError(message);
      announce(`Launch blocked: ${message}`);
      return;
    }

    const bridge = window.myclaude?.sessions;
    if (!bridge?.launch) {
      const message = "Session launch bridge is unavailable.";
      setLaunchError(message);
      announce(`Launch failed: ${message}`);
      return;
    }

    setIsLaunching(true);
    setLaunchError(null);
    setLibrarySwitchError(null);
    try {
      const result = await bridge.launch(launchPayload);
      setActiveTerminalSessionId(result.sessionId);
      setCurrentScreen("sessions");
      announce("Claude session launched");
    } catch (error) {
      const message = formatProfileLaunchError(error);
      setLaunchError(message);
      announce(`Launch failed: ${message}`);
    } finally {
      setIsLaunching(false);
    }
  }, [announce, setActiveTerminalSessionId, setCurrentScreen]);

  const handleLaunch = React.useCallback(() => {
    const currentAgentProfile = latestAgentProfileRef.current;
    if (!currentAgentProfile.launch.payload) {
      void executeLaunch();
      return;
    }
    draftGuard.request(() => {
      void executeLaunch();
    });
  }, [draftGuard, executeLaunch]);

  const readinessLabel = getReadinessLabel(
    agentProfile.readiness.status,
    agentProfile.readiness.label
  );
  const readinessTone = mapReadinessTone(agentProfile.readiness.tone);
  const activeReadinessIssue =
    agentProfile.readiness.blockingReason ?? agentProfile.readiness.warnings[0] ?? null;
  const fixActionLabel = activeReadinessIssue?.fixLabel ?? "Configure profile";
  const capabilityLine = [
    formatCount(agentProfile.toolSkillCounts.tools, "MCP server"),
    formatCount(agentProfile.toolSkillCounts.personaAssets, "skill/persona asset"),
  ].join(" · ");

  return (
    <ScreenSurface data-testid="agent-profiles-home">
      <ScreenHeader
        title="Agent Profiles"
        description="Choose a working profile, check readiness, and launch Claude from one calm place."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              data-testid="home-new-agent-profile"
              onClick={openCreateDialog}
              ref={createButtonRef}
              type="button"
              variant="primary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Agent Profile
            </Button>
            <Button
              data-testid="home-open-profile-workspace"
              onClick={openProfileWorkspace}
              type="button"
              variant="secondary"
            >
              Open Profile Workspace
            </Button>
          </div>
        }
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 overflow-auto p-6 app-scrollbar">
          <section className="mx-auto grid max-w-6xl gap-6">
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-tertiary">
                Primary loop
              </p>
              <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.03em] text-primary text-balance">
                Pick the profile that matches the work, then launch Claude.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-secondary text-pretty">
                Configuration stays close, but the opening surface is for choosing, understanding
                readiness, and moving into a session without reading the machinery underneath.
              </p>
            </div>

            <article
              aria-labelledby="current-agent-profile-title"
              className="overflow-hidden rounded-xl border border-default bg-surface shadow-xs"
              data-testid="agent-profile-card"
            >
              <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="flex min-w-0 gap-4">
                  <IconFrame icon={Sparkles} size="lg" tone="accent" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
                        {agentProfile.card.eyebrow}
                      </p>
                      <StatusChip tone={readinessTone}>{readinessLabel}</StatusChip>
                    </div>
                    <h3
                      className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-primary text-balance"
                      id="current-agent-profile-title"
                    >
                      {agentProfile.card.title}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary text-pretty">
                      {agentProfile.card.primaryLine}
                    </p>

                    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                      <ProfileFact
                        icon={KeyRound}
                        label="Claude identity"
                        value={agentProfile.auth.label}
                        detail={agentProfile.auth.modeLabel}
                      />
                      <ProfileFact
                        icon={FolderOpen}
                        label="Workspace"
                        value={agentProfile.workspace.label}
                        detail={agentProfile.workspace.detail}
                      />
                      <ProfileFact
                        icon={Wrench}
                        label="Capability"
                        value={capabilityLine}
                        detail={`${formatCount(agentProfile.toolSkillCounts.envVars, "environment variable")} · ${formatCount(agentProfile.toolSkillCounts.settings, "setting")}`}
                      />
                    </dl>
                  </div>
                </div>

                <div className="grid min-w-[13rem] gap-3 lg:justify-items-stretch">
                  <Button
                    aria-describedby="home-launch-status"
                    className="min-h-10"
                    data-testid="home-launch-button"
                    disabled={!agentProfile.launch.canLaunch || isLaunching}
                    onClick={() => void handleLaunch()}
                    type="button"
                    variant="primary"
                  >
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                    {isLaunching ? "Launching…" : agentProfile.launch.label}
                  </Button>
                  <Button
                    className="min-h-10"
                    data-testid="home-view-profile-details"
                    onClick={openProfileDetails}
                    ref={detailsButtonRef}
                    type="button"
                    variant="secondary"
                  >
                    View details
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    className="min-h-10"
                    data-testid="profile-basics-open"
                    onClick={openBasicsPanel}
                    ref={basicsButtonRef}
                    type="button"
                    variant="secondary"
                  >
                    Customize basics
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    className="min-h-10"
                    data-testid="profile-tools-open"
                    onClick={openToolsPanel}
                    ref={toolsButtonRef}
                    type="button"
                    variant="secondary"
                  >
                    Customize tools
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    className="min-h-10"
                    data-testid="profile-skills-persona-open"
                    onClick={openSkillsPersonaPanel}
                    ref={skillsPersonaButtonRef}
                    type="button"
                    variant="secondary"
                  >
                    Customize skills & persona
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    className="min-h-10"
                    data-testid="home-secondary-action"
                    onClick={activeReadinessIssue ? handleFixPath : openProfileWorkspace}
                    type="button"
                    variant="secondary"
                  >
                    {activeReadinessIssue ? fixActionLabel : "Configure profile"}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <p className="text-xs leading-5 text-tertiary" id="home-launch-status">
                    {agentProfile.launch.disabledReason ??
                      "Ready profiles launch with the selected identity and workspace."}
                  </p>
                </div>
              </div>

              {agentProfile.readiness.blockingReason ? (
                <div
                  className="border-t border-subtle bg-status-warning-soft px-6 py-3 text-sm text-status-warning"
                  data-testid="home-readiness-blocker"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>{agentProfile.readiness.blockingReason.message}</p>
                  </div>
                </div>
              ) : null}

              {agentProfile.readiness.warnings.length > 0 ? (
                <div
                  className="border-t border-subtle bg-status-warning-soft px-6 py-3 text-sm text-status-warning"
                  data-testid="home-readiness-warning"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>{agentProfile.readiness.warnings[0]?.message}</p>
                  </div>
                </div>
              ) : null}

              {launchError ? (
                <div
                  className="border-t border-status-danger bg-status-danger-soft px-6 py-3 text-sm text-status-danger"
                  data-testid="home-launch-error"
                >
                  {launchError}
                </div>
              ) : null}
            </article>

            <AgentProfileLibrarySection
              errorMessage={librarySwitchError}
              items={profileLibrary.items}
              onSelect={(item, element) => handleSelectProfile(item, element)}
              switchingProfileId={switchingProfileId}
            />
          </section>
        </div>
        <AgentProfileSidePanel
          activeSection={panelSection}
          onClose={closeProfileDetails}
          onOpenClaudeAuth={openClaudeAuth}
          onOpenProfileSkillsPersona={openSkillsPersonaPanel}
          onOpenProfileTools={openToolsPanel}
          onOpenProfileWorkspace={openProfileWorkspaceTab}
          onRepairToolSecret={requestToolSecretRepair}
          onSectionChange={setPanelSection}
          open={isPanelOpenForProfile}
          profile={agentProfile}
        />
        <ProfileBasicsPanel
          authProfiles={authProfiles}
          currentEffective={effectiveState.effective}
          cwd={cwd}
          onOpenAdvanced={() => {
            goToProfileWorkspaceTab("layers");
          }}
          onOpenChange={(open) => {
            if (!open) closeBasicsPanel();
            else setBasicsPanelOpen(true);
          }}
          onOpenClaudeAuth={goToClaudeAuth}
          onPreviewStateChange={setPreviewState}
          onSaved={handleBasicsSaved}
          onValidationStateChange={setValidationState}
          open={basicsPanelOpen}
          profile={agentProfile}
          scopeEntries={scopeEntries}
          selectedAuthId={agentProfile.details.inspectTarget.authProfileId ?? ""}
          selectedRole={agentProfile.details.inspectTarget.role ?? ""}
        />
        <ProfileMcpToolsPanel
          currentEffective={effectiveState.effective}
          cwd={cwd}
          onOpenAdvanced={() => {
            goToProfileWorkspaceTab("layers");
          }}
          onOpenChange={(open) => {
            if (!open) closeToolsPanel();
            else setToolsPanelOpen(true);
          }}
          onPreviewStateChange={setPreviewState}
          onRepairMissingSecret={requestToolSecretRepair}
          onSaved={handleBasicsSaved}
          onValidationStateChange={setValidationState}
          open={toolsPanelOpen}
          profile={agentProfile}
          scopeEntries={scopeEntries}
          selectedAuthId={agentProfile.details.inspectTarget.authProfileId ?? ""}
          selectedRole={agentProfile.details.inspectTarget.role ?? ""}
        />
        <ProfileSkillsPersonaPanel
          cwd={cwd}
          onOpenAdvanced={() => {
            goToProfileWorkspaceTab("layers");
          }}
          onOpenChange={(open) => {
            if (!open) closeSkillsPersonaPanel();
            else setSkillsPersonaPanelOpen(true);
          }}
          onPreviewStateChange={setPreviewState}
          onSaved={handleBasicsSaved}
          onValidationStateChange={setValidationState}
          open={skillsPersonaPanelOpen}
          profile={agentProfile}
          scopeEntries={scopeEntries}
          selectedAuthId={agentProfile.details.inspectTarget.authProfileId ?? ""}
          selectedRole={agentProfile.details.inspectTarget.role ?? ""}
        />
      </div>
      <CreateAgentProfileDialog
        authProfiles={authProfiles}
        createError={createProfileError}
        currentAuthProfileId={
          agentProfile.auth.state === "selected" ? (agentProfile.auth.profileId ?? "") : ""
        }
        currentCwd={cwd || agentProfile.workspace.detail || ""}
        existingRoles={availableRoles}
        isCreating={isCreatingProfile}
        onClearError={() => setCreateProfileError(null)}
        onCreate={handleCreateProfile}
        onOpenChange={(open) => {
          if (open) {
            setCreateDialogOpen(true);
            return;
          }
          closeCreateDialog();
        }}
        onOpenClaudeAuth={openClaudeAuth}
        open={createDialogOpen}
      />
      <ProfileUnsavedChangesDialog guard={draftGuard} />
    </ScreenSurface>
  );
}

function AgentProfileLibrarySection({
  errorMessage,
  items,
  onSelect,
  switchingProfileId,
}: {
  errorMessage: string | null;
  items: readonly AgentProfileLibraryItem[];
  onSelect: (item: AgentProfileLibraryItem, returnFocusTo?: HTMLElement | null) => void;
  switchingProfileId: string | null;
}): React.ReactElement {
  return (
    <section
      aria-labelledby="agent-profile-library-heading"
      className="rounded-xl border border-default bg-surface p-5 shadow-xs"
      data-testid="agent-profile-library"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
            Profile library
          </p>
          <h3
            className="mt-2 text-xl font-semibold tracking-[-0.02em] text-primary"
            id="agent-profile-library-heading"
          >
            Switch to the profile that matches the work.
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">
            Purpose names stay up front; identity, workspace, and capability signals stay calm and
            inspectable.
          </p>
        </div>
        <StatusChip tone="info">{formatCount(items.length, "profile")}</StatusChip>
      </div>

      {errorMessage ? (
        <div
          className="mt-4 rounded-lg border border-status-danger bg-status-danger-soft px-4 py-3 text-sm text-status-danger"
          data-testid="agent-profile-library-error"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const isSwitching = switchingProfileId === item.id;
            return (
              <li key={item.id}>
                <button
                  aria-current={item.isSelected ? "true" : undefined}
                  className={`group h-full min-h-36 w-full rounded-xl border px-4 py-4 text-left shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                    item.isSelected
                      ? "border-accent bg-accent-soft/70"
                      : "border-subtle bg-canvas/50 hover:border-muted hover:bg-surface"
                  }`}
                  data-testid="agent-profile-library-item"
                  disabled={Boolean(switchingProfileId)}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                    onSelect(item, event.currentTarget)
                  }
                  type="button"
                >
                  <span className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-primary">
                        {item.displayName}
                      </span>
                      <span className="mt-1 block line-clamp-2 text-sm leading-5 text-secondary">
                        {item.purpose}
                      </span>
                    </span>
                    <StatusChip tone={item.statusTone}>
                      {isSwitching ? "Switching…" : item.statusLabel}
                    </StatusChip>
                  </span>

                  <span className="mt-4 flex flex-wrap gap-2">
                    <LibraryChip label={item.role} />
                    <LibraryChip label={item.authLabel} />
                    <LibraryChip label={item.workspaceLabel} />
                  </span>
                  <span className="mt-3 block text-xs font-medium text-tertiary">
                    {item.capabilitySummary}
                  </span>
                  {item.isSelected ? (
                    <span
                      className="mt-3 inline-flex text-xs font-semibold text-accent"
                      data-testid="agent-profile-library-selected"
                    >
                      Selected profile
                    </span>
                  ) : null}
                  {!item.isSelected && item.disabledReason ? (
                    <span className="mt-3 block text-xs text-status-warning">
                      {item.disabledReason}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-subtle bg-canvas/50 px-4 py-6 text-sm text-secondary">
          Create an Agent Profile to build your library.
        </div>
      )}
    </section>
  );
}

function LibraryChip({ label }: { label: string }): React.ReactElement {
  return (
    <span className="max-w-full truncate rounded-full border border-subtle bg-surface px-2.5 py-1 text-xs font-medium text-secondary">
      {label}
    </span>
  );
}

function CreateAgentProfileDialog({
  authProfiles,
  createError,
  currentAuthProfileId,
  currentCwd,
  existingRoles,
  isCreating,
  onClearError,
  onCreate,
  onOpenChange,
  onOpenClaudeAuth,
  open,
}: {
  authProfiles: readonly AuthProfileOption[];
  createError: string | null;
  currentAuthProfileId: string;
  currentCwd: string;
  existingRoles: readonly string[];
  isCreating: boolean;
  onClearError: () => void;
  onCreate: (value: ProfileCreationResolvedDraft) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onOpenClaudeAuth: () => void;
  open: boolean;
}): React.ReactElement {
  const announce = useAnnounce();
  const initialFocusRef = React.useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = React.useState<ProfileCreationDraft>(() =>
    createInitialProfileDraft(currentCwd, currentAuthProfileId, authProfiles)
  );
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(createInitialProfileDraft(currentCwd, currentAuthProfileId, authProfiles));
    setPickerError(null);
    const frameId = window.requestAnimationFrame(() => {
      initialFocusRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [authProfiles, currentAuthProfileId, currentCwd, open]);

  const validation = validateProfileCreationDraft(draft, {
    existingRoles,
    authProfiles,
  });
  const resolved = validation.value;
  const selection = buildProfileSelection(resolved);
  const issuesByField = React.useMemo(
    () => mapIssuesByField(validation.issues),
    [validation.issues]
  );
  const rolePreview = resolved.roleSlug || deriveProfileRoleSlug(draft.purpose) || "profile-role";
  const selectedAuth = authProfiles.find((profile) => profile.id === draft.authProfileId) ?? null;
  const authOptions = authProfiles.map((profile) => ({
    value: profile.id,
    label: `${profile.displayName} · ${formatAuthMode(profile.mode)}`,
  }));

  const updateDraft = React.useCallback(
    (patch: Partial<ProfileCreationDraft>) => {
      onClearError();
      setPickerError(null);
      setDraft((current) => ({ ...current, ...patch }));
    },
    [onClearError]
  );

  const handlePickWorkspace = React.useCallback(async () => {
    const picker = window.myclaude?.system?.pickDirectory;
    if (!picker) {
      setPickerError("Workspace picker is unavailable. You can use the current workspace.");
      return;
    }
    try {
      const next = await picker();
      if (next) {
        updateDraft({ cwd: next });
      }
    } catch {
      setPickerError("Workspace picker could not open. You can use the current workspace.");
    }
  }, [updateDraft]);

  const handleConnectClaudeAuth = React.useCallback(() => {
    onOpenChange(false);
    onOpenClaudeAuth();
  }, [onOpenChange, onOpenClaudeAuth]);

  const handleReview = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!validation.ok) {
        announce("Agent Profile needs a little more detail before it can be created");
        return;
      }
      void onCreate(resolved);
    },
    [announce, onCreate, resolved, validation.ok]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="profile-create-dialog">
        <form className="grid gap-5" onSubmit={handleReview}>
          <DialogHeader>
            <DialogTitle>Create a new Agent Profile</DialogTitle>
            <DialogDescription>
              Describe the work, choose where it runs, and bind the Claude identity it should use.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <Field
              description="Use the job this profile should do, such as Backend API Review or Frontend Polish."
              htmlFor="profile-create-purpose"
              label="Purpose"
              {...fieldErrorProps(issuesByField.purpose)}
            >
              <Input
                aria-invalid={issuesByField.purpose ? true : undefined}
                data-testid="profile-create-purpose"
                id="profile-create-purpose"
                onChange={(event) => updateDraft({ purpose: event.currentTarget.value })}
                placeholder="Backend API Review"
                ref={initialFocusRef}
                value={draft.purpose}
              />
            </Field>

            <div
              className="rounded-lg border border-subtle bg-canvas/60 px-4 py-3"
              data-testid="profile-create-preview"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
                    Profile role preview
                  </p>
                  <p className="mt-1 font-mono text-sm text-primary">{rolePreview}</p>
                </div>
                <StatusChip tone={issuesByField.role ? "warning" : "info"}>
                  {issuesByField.role ? "Needs a safer name" : "Safe role name"}
                </StatusChip>
              </div>
              {issuesByField.role ? (
                <p className="mt-2 text-xs font-medium text-status-warning">{issuesByField.role}</p>
              ) : (
                <p className="mt-2 text-xs text-secondary">
                  This safe name is generated from the purpose and keeps raw file details out of the
                  default flow.
                </p>
              )}
            </div>

            <Field
              description="The profile will start from this workspace."
              htmlFor="profile-create-workspace"
              label="Workspace"
              {...fieldErrorProps(issuesByField.workspace ?? pickerError)}
            >
              <div className="flex gap-2">
                <Input
                  aria-invalid={issuesByField.workspace || pickerError ? true : undefined}
                  className="font-mono text-xs"
                  data-testid="profile-create-workspace"
                  id="profile-create-workspace"
                  onChange={(event) => updateDraft({ cwd: event.currentTarget.value })}
                  value={draft.cwd}
                />
                <Button
                  className="min-h-10 shrink-0"
                  data-testid="profile-create-pick-workspace"
                  onClick={() => void handlePickWorkspace()}
                  type="button"
                  variant="secondary"
                >
                  Choose…
                </Button>
              </div>
            </Field>

            <Field
              description="Claude Auth owns credentials; this flow only chooses the identity."
              label="Claude identity"
              {...fieldErrorProps(issuesByField.identity)}
            >
              {authProfiles.length > 0 ? (
                <Select
                  aria-label="Claude identity"
                  className="min-h-10"
                  onValueChange={(value) => updateDraft({ authProfileId: value })}
                  options={authOptions}
                  value={draft.authProfileId}
                />
              ) : (
                <div className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning">
                  Add a Claude identity before creating an Agent Profile.
                </div>
              )}
            </Field>
          </div>

          <section
            aria-live="polite"
            className="rounded-lg border border-default bg-surface px-4 py-3"
            data-testid="profile-create-review"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
              Creation preview
            </p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <ProfileCreationFact label="Purpose" value={resolved.purpose || "Not set"} />
              <ProfileCreationFact label="Role" value={selection.role || rolePreview} />
              <ProfileCreationFact
                label="Claude identity"
                value={selectedAuth?.displayName ?? "Not selected"}
              />
            </dl>
            {createError ? (
              <p
                className="mt-3 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger"
                data-testid="profile-create-error"
                role="alert"
              >
                {createError}
              </p>
            ) : (
              <p className="mt-3 text-xs text-secondary">
                Creating the profile saves it through the desktop bridge, then selects it here.
              </p>
            )}
          </section>

          <DialogFooter className="flex-wrap gap-3">
            <Button
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            {authProfiles.length === 0 ? (
              <Button
                disabled={isCreating}
                onClick={handleConnectClaudeAuth}
                type="button"
                variant="secondary"
              >
                Connect Claude identity
              </Button>
            ) : null}
            <Button
              data-testid="profile-create-review-action"
              disabled={!validation.ok || isCreating}
              type="submit"
              variant="primary"
            >
              {isCreating ? "Creating…" : "Create Agent Profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatProfileSwitchError(error: unknown): string {
  const message = getErrorMessage(error);
  if (containsUnsafeHomeDiagnosticText(message)) {
    return "Agent Profile could not be selected. Try again or review the profile details.";
  }
  if (/identity|auth/i.test(message)) {
    return "This Agent Profile needs an available Claude identity before it can be selected.";
  }
  if (/workspace|cwd|directory|path/i.test(message)) {
    return "This Agent Profile workspace is unavailable. Choose another profile or workspace.";
  }
  return "Agent Profile could not be selected. Try again or review the profile details.";
}

function formatProfileLaunchError(error: unknown): string {
  const message = getErrorMessage(error);
  if (containsUnsafeHomeDiagnosticText(message)) {
    return "Claude session could not be launched. Review profile readiness and try again.";
  }
  if (/identity|auth/i.test(message)) {
    return "Claude session could not be launched because the selected identity needs attention.";
  }
  if (/workspace|cwd|directory|path/i.test(message)) {
    return "Claude session could not be launched because the workspace is unavailable.";
  }
  return message || "Claude session could not be launched. Review profile readiness and try again.";
}

function containsUnsafeHomeDiagnosticText(message: string): boolean {
  return /\.myclaude|project-role|global-role|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|oauth|authorization/i.test(
    message
  );
}

function findScopePathForRole(
  entries: ReadonlyArray<{ role: string; path: string; scope?: string; content?: unknown }>,
  role: string
): string | null {
  if (!role) return null;
  return (
    entries.find((entry) => entry.role === role && entry.scope === "project-role" && entry.content)
      ?.path ??
    entries.find((entry) => entry.role === role && entry.scope === "project-role")?.path ??
    entries.find((entry) => entry.role === role && entry.scope?.includes("role") && entry.content)
      ?.path ??
    entries.find((entry) => entry.role === role)?.path ??
    entries[0]?.path ??
    null
  );
}

function ProfileCreationFact({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="min-w-0 rounded-md border border-subtle bg-canvas/60 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-tertiary">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-primary">{value}</dd>
    </div>
  );
}

function createInitialProfileDraft(
  cwd: string,
  currentAuthProfileId: string,
  authProfiles: readonly AuthProfileOption[]
): ProfileCreationDraft {
  const selectedAuthProfileId = currentAuthProfileId || authProfiles[0]?.id || "";
  return {
    purpose: "",
    cwd,
    authProfileId: selectedAuthProfileId,
  };
}

function mapIssuesByField(
  issues: readonly ProfileCreationValidationIssue[]
): Partial<Record<ProfileCreationField, string>> {
  const byField: Partial<Record<ProfileCreationField, string>> = {};
  for (const issue of issues) {
    byField[issue.field] ??= issue.message;
  }
  return byField;
}

function fieldErrorProps(
  error: string | null | undefined
): { error: string } | Record<string, never> {
  return error ? { error } : {};
}

function formatAuthMode(mode: string): string {
  if (mode === "apiKey") return "API key";
  if (mode === "oauth") return "OAuth";
  return mode;
}

function ProfileFact({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="min-w-0 rounded-lg border border-subtle bg-canvas/60 px-3 py-3 shadow-xs">
      <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-tertiary">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 truncate text-sm font-medium text-primary">{value}</dd>
      <dd className="mt-1 truncate text-xs text-secondary">{detail}</dd>
    </div>
  );
}

function getReadinessLabel(status: string, fallback: string): string {
  if (status === "ready") return "Ready to launch";
  if (status === "warning") return "Ready with review";
  return fallback;
}

function mapReadinessTone(tone: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  return "neutral";
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

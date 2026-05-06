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
  Plus,
  Rocket,
  Sparkles,
  type LucideIcon,
  Wrench,
} from "lucide-react";
import * as React from "react";
import {
  activeTerminalSessionIdAtom,
  agentProfilePanelSectionAtom,
  authProfilesAtom,
  availableRolesAtom,
  currentScreenAtom,
  cwdAtom,
  type ProfileWorkspaceTab,
  profileWorkspaceTabAtom,
  selectedAgentProfilePanelIdAtom,
} from "../lib/atoms.js";
import { agentProfileViewModelAtom } from "../lib/agent-profile-view-model.js";
import {
  buildProfileSelection,
  deriveProfileRoleSlug,
  validateProfileCreationDraft,
  type ProfileCreationDraft,
  type ProfileCreationField,
  type ProfileCreationValidationIssue,
} from "../lib/profile-creation.js";
import { getErrorMessage } from "../lib/normalize.js";
import { AgentProfileSidePanel } from "../components/agent-profile-side-panel.js";
import { useAnnounce } from "../components/live-announcer.js";
import { IconFrame, ScreenHeader, ScreenSurface, StatusChip } from "../components/screen-ui.js";
import type { AuthProfileOption } from "../lib/types.js";

export function AgentProfilesHomeScreen(): React.ReactElement {
  const agentProfile = useAtomValue(agentProfileViewModelAtom);
  const authProfiles = useAtomValue(authProfilesAtom);
  const availableRoles = useAtomValue(availableRolesAtom);
  const cwd = useAtomValue(cwdAtom);
  const [selectedPanelProfileId, setSelectedPanelProfileId] = useAtom(
    selectedAgentProfilePanelIdAtom
  );
  const [panelSection, setPanelSection] = useAtom(agentProfilePanelSectionAtom);
  const setActiveTerminalSessionId = useSetAtom(activeTerminalSessionIdAtom);
  const setCurrentScreen = useSetAtom(currentScreenAtom);
  const setProfileWorkspaceTab = useSetAtom(profileWorkspaceTabAtom);
  const announce = useAnnounce();
  const [isLaunching, setIsLaunching] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const createButtonRef = React.useRef<HTMLButtonElement | null>(null);
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

  const openProfileWorkspaceTab = React.useCallback(
    (tab: ProfileWorkspaceTab) => {
      setLaunchError(null);
      setProfileWorkspaceTab(tab);
      setCurrentScreen("editor");
    },
    [setCurrentScreen, setProfileWorkspaceTab]
  );

  const openProfileWorkspace = React.useCallback(() => {
    openProfileWorkspaceTab("overview");
  }, [openProfileWorkspaceTab]);

  const closeCreateDialog = React.useCallback(() => {
    setCreateDialogOpen(false);
    window.requestAnimationFrame(() => {
      createButtonRef.current?.focus();
    });
  }, []);

  const openCreateDialog = React.useCallback(() => {
    setLaunchError(null);
    setSelectedPanelProfileId(null);
    setPanelSection("summary");
    setCreateDialogOpen(true);
  }, [setPanelSection, setSelectedPanelProfileId]);

  const openClaudeAuth = React.useCallback(() => {
    setLaunchError(null);
    setCurrentScreen("auth-vault");
  }, [setCurrentScreen]);

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
    setProfileWorkspaceTab("overview");
    setCurrentScreen("editor");
  }, [
    agentProfile.id,
    agentProfile.readiness.blockingReason?.fixTarget,
    agentProfile.readiness.warnings,
    openClaudeAuth,
    setCurrentScreen,
    setPanelSection,
    setProfileWorkspaceTab,
    setSelectedPanelProfileId,
  ]);

  const handleLaunch = React.useCallback(async () => {
    const launchPayload = agentProfile.launch.payload;
    if (!launchPayload) {
      const message = agentProfile.launch.disabledReason ?? "Profile is not ready to launch.";
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
    try {
      const result = await bridge.launch(launchPayload);
      setActiveTerminalSessionId(result.sessionId);
      setCurrentScreen("sessions");
      announce("Claude session launched");
    } catch (error) {
      const message = getErrorMessage(error);
      setLaunchError(message);
      announce(`Launch failed: ${message}`);
    } finally {
      setIsLaunching(false);
    }
  }, [
    agentProfile.launch.disabledReason,
    agentProfile.launch.payload,
    announce,
    setActiveTerminalSessionId,
    setCurrentScreen,
  ]);

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
          </section>
        </div>
        <AgentProfileSidePanel
          activeSection={panelSection}
          onClose={closeProfileDetails}
          onOpenClaudeAuth={openClaudeAuth}
          onOpenProfileWorkspace={openProfileWorkspaceTab}
          onSectionChange={setPanelSection}
          open={isPanelOpenForProfile}
          profile={agentProfile}
        />
      </div>
      <CreateAgentProfileDialog
        authProfiles={authProfiles}
        currentAuthProfileId={
          agentProfile.auth.state === "selected" ? (agentProfile.auth.profileId ?? "") : ""
        }
        currentCwd={cwd || agentProfile.workspace.detail || ""}
        existingRoles={availableRoles}
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
    </ScreenSurface>
  );
}

function CreateAgentProfileDialog({
  authProfiles,
  currentAuthProfileId,
  currentCwd,
  existingRoles,
  onOpenChange,
  onOpenClaudeAuth,
  open,
}: {
  authProfiles: readonly AuthProfileOption[];
  currentAuthProfileId: string;
  currentCwd: string;
  existingRoles: readonly string[];
  onOpenChange: (open: boolean) => void;
  onOpenClaudeAuth: () => void;
  open: boolean;
}): React.ReactElement {
  const announce = useAnnounce();
  const initialFocusRef = React.useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = React.useState<ProfileCreationDraft>(() =>
    createInitialProfileDraft(currentCwd, currentAuthProfileId, authProfiles)
  );
  const [reviewReady, setReviewReady] = React.useState(false);
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(createInitialProfileDraft(currentCwd, currentAuthProfileId, authProfiles));
    setReviewReady(false);
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

  const updateDraft = React.useCallback((patch: Partial<ProfileCreationDraft>) => {
    setReviewReady(false);
    setPickerError(null);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

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
        setReviewReady(false);
        announce("Agent Profile needs a little more detail before it can be created");
        return;
      }
      setReviewReady(true);
      announce("Agent Profile is ready to create");
    },
    [announce, validation.ok]
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
            {reviewReady ? (
              <p
                className="mt-3 rounded-md border border-status-success bg-status-success-soft px-3 py-2 text-sm text-status-success"
                data-testid="profile-create-ready"
              >
                This Agent Profile is ready for the save step. Nothing has been changed yet.
              </p>
            ) : (
              <p className="mt-3 text-xs text-secondary">
                Review becomes available once purpose, workspace, and Claude identity are valid.
              </p>
            )}
          </section>

          <DialogFooter className="flex-wrap gap-3">
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
              Cancel
            </Button>
            {authProfiles.length === 0 ? (
              <Button onClick={handleConnectClaudeAuth} type="button" variant="secondary">
                Connect Claude identity
              </Button>
            ) : null}
            <Button
              data-testid="profile-create-review-action"
              disabled={!validation.ok}
              type="submit"
              variant="primary"
            >
              Review Agent Profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

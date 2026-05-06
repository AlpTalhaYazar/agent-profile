import { Button } from "@agent-profile/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  AlertTriangle,
  ArrowRight,
  FolderOpen,
  KeyRound,
  Rocket,
  Sparkles,
  type LucideIcon,
  Wrench,
} from "lucide-react";
import * as React from "react";
import {
  activeTerminalSessionIdAtom,
  agentProfilePanelSectionAtom,
  currentScreenAtom,
  type ProfileWorkspaceTab,
  profileWorkspaceTabAtom,
  selectedAgentProfilePanelIdAtom,
} from "../lib/atoms.js";
import { agentProfileViewModelAtom } from "../lib/agent-profile-view-model.js";
import { getErrorMessage } from "../lib/normalize.js";
import { AgentProfileSidePanel } from "../components/agent-profile-side-panel.js";
import { useAnnounce } from "../components/live-announcer.js";
import { IconFrame, ScreenHeader, ScreenSurface, StatusChip } from "../components/screen-ui.js";

export function AgentProfilesHomeScreen(): React.ReactElement {
  const agentProfile = useAtomValue(agentProfileViewModelAtom);
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
          <Button
            data-testid="home-open-profile-workspace"
            onClick={openProfileWorkspace}
            type="button"
            variant="secondary"
          >
            Open Profile Workspace
          </Button>
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
    </ScreenSurface>
  );
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

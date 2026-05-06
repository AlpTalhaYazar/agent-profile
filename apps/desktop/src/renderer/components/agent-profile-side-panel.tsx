import { Button, cn } from "@agent-profile/ui";
import {
  BadgeCheck,
  Blocks,
  CheckCircle2,
  CircleAlert,
  Code2,
  FolderOpen,
  KeyRound,
  Layers3,
  ListChecks,
  Settings2,
  Sparkles,
  type LucideIcon,
  Wrench,
  X,
} from "lucide-react";
import * as React from "react";
import type { AgentProfileViewModel } from "../lib/agent-profile-view-model.js";
import type { AgentProfilePanelSection, ProfileWorkspaceTab } from "../lib/atoms.js";
import { usePrefersReducedMotion } from "../lib/use-prefers-reduced-motion.js";
import { IconFrame, StatusChip } from "./screen-ui.js";

const EXIT_TRANSITION_MS = 180;

interface AgentProfileSidePanelProps {
  activeSection: AgentProfilePanelSection;
  onClose: () => void;
  onOpenClaudeAuth: () => void;
  onOpenProfileTools: () => void;
  onOpenProfileWorkspace: (tab: ProfileWorkspaceTab) => void;
  onSectionChange: (section: AgentProfilePanelSection) => void;
  open: boolean;
  profile: AgentProfileViewModel;
}

const PANEL_SECTIONS: Array<{
  id: AgentProfilePanelSection;
  label: string;
}> = [
  { id: "summary", label: "Summary" },
  { id: "identity", label: "Identity" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "inspect", label: "Inspect" },
];

export function AgentProfileSidePanel({
  activeSection,
  onClose,
  onOpenClaudeAuth,
  onOpenProfileTools,
  onOpenProfileWorkspace,
  onSectionChange,
  open,
  profile,
}: AgentProfileSidePanelProps): React.ReactElement | null {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [shouldRender, setShouldRender] = React.useState(open);
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }

    if (prefersReducedMotion) {
      setShouldRender(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRender(false);
    }, EXIT_TRANSITION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, prefersReducedMotion]);

  React.useEffect(() => {
    if (!open || !shouldRender) return;
    const frameId = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [open, shouldRender]);

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!shouldRender) return null;

  const visible = open || prefersReducedMotion;
  const readinessTone = mapReadinessTone(profile.readiness.tone);
  const readinessIcon = profile.readiness.canLaunch ? CheckCircle2 : CircleAlert;

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex justify-end p-4",
        prefersReducedMotion
          ? ""
          : cn(
              "transition-[opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
              visible ? "opacity-100" : "opacity-0"
            )
      )}
      data-motion={prefersReducedMotion ? "reduced" : "standard"}
      data-state={open ? "open" : "closed"}
      data-testid="agent-profile-side-panel-frame"
    >
      <aside
        aria-labelledby="agent-profile-side-panel-title"
        className={cn(
          "pointer-events-auto flex h-full min-h-0 w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-default bg-surface shadow-xl",
          prefersReducedMotion
            ? ""
            : cn(
                "transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                visible ? "translate-x-0 opacity-100" : "translate-x-5 opacity-0"
              )
        )}
        data-profile-id={profile.id}
        data-section={activeSection}
        data-testid="agent-profile-side-panel"
        tabIndex={-1}
      >
        <header className="border-b border-subtle bg-surface/95 px-5 py-4">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <IconFrame icon={Sparkles} size="sm" tone="accent" />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
                  Agent Profile
                </p>
                <h2
                  className="mt-1 truncate text-xl font-semibold tracking-[-0.02em] text-primary"
                  id="agent-profile-side-panel-title"
                >
                  {profile.name}
                </h2>
                <p className="mt-1 truncate text-sm text-secondary">{profile.purposeLabel}</p>
              </div>
            </div>
            <Button
              aria-label="Close profile details"
              className="min-h-10 min-w-10 shrink-0"
              data-testid="agent-profile-side-panel-close"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusChip tone={readinessTone}>
              {React.createElement(readinessIcon, {
                className: "h-3.5 w-3.5",
                "aria-hidden": true,
              })}
              {getReadinessLabel(profile.readiness.status, profile.readiness.label)}
            </StatusChip>
            <StatusChip tone="neutral">{profile.auth.label}</StatusChip>
            <StatusChip tone="neutral">{profile.workspace.label}</StatusChip>
          </div>
        </header>

        <nav
          className="border-b border-subtle bg-canvas/55 px-4 py-3"
          aria-label="Profile detail sections"
        >
          <div className="grid grid-cols-5 gap-1 rounded-lg bg-subtle p-1">
            {PANEL_SECTIONS.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "min-h-10 rounded-md px-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-surface text-primary shadow-xs"
                      : "text-secondary hover:bg-surface/70 hover:text-primary"
                  )}
                  data-testid={`agent-profile-panel-section-${section.id}`}
                  key={section.id}
                  onClick={() => onSectionChange(section.id)}
                  type="button"
                >
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-5 app-scrollbar">
          {activeSection === "summary" ? <SummarySection profile={profile} /> : null}
          {activeSection === "identity" ? (
            <IdentitySection onOpenClaudeAuth={onOpenClaudeAuth} profile={profile} />
          ) : null}
          {activeSection === "tools" ? (
            <ToolsSection
              onOpenProfileTools={onOpenProfileTools}
              onOpenProfileWorkspace={onOpenProfileWorkspace}
              profile={profile}
            />
          ) : null}
          {activeSection === "skills" ? <SkillsSection profile={profile} /> : null}
          {activeSection === "inspect" ? <InspectSection profile={profile} /> : null}
        </div>
      </aside>
    </div>
  );
}

function SummarySection({ profile }: { profile: AgentProfileViewModel }): React.ReactElement {
  return (
    <section className="grid gap-4" data-testid="agent-profile-panel-summary">
      <section
        className="rounded-lg border border-subtle bg-canvas/60 p-4"
        data-testid="agent-profile-panel-failure-summary"
      >
        <div className="flex items-start gap-3">
          <IconFrame
            icon={profile.readiness.canLaunch ? BadgeCheck : CircleAlert}
            size="sm"
            tone={profile.readiness.canLaunch ? "success" : "warning"}
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-primary">
              {getReadinessLabel(profile.readiness.status, profile.readiness.label)}
            </h3>
            <p className="mt-1 text-sm leading-6 text-secondary text-pretty">
              {profile.readiness.blockingReason?.message ??
                profile.readiness.warnings[0]?.message ??
                "This profile can launch with the selected identity and workspace."}
            </p>
          </div>
        </div>
      </section>

      <dl className="grid gap-3">
        <DetailFact
          detail={profile.auth.modeLabel}
          icon={KeyRound}
          label="Claude identity"
          value={profile.auth.label}
        />
        <DetailFact
          detail={profile.workspace.detail}
          icon={FolderOpen}
          label="Workspace"
          value={profile.workspace.label}
        />
        <DetailFact
          detail={`${formatCount(profile.toolSkillCounts.envVars, "environment variable")} · ${formatCount(profile.toolSkillCounts.settings, "setting")}`}
          icon={Wrench}
          label="Capabilities"
          value={`${formatCount(profile.toolSkillCounts.tools, "MCP server")} · ${formatCount(profile.toolSkillCounts.personaAssets, "skill/persona asset")}`}
        />
      </dl>
    </section>
  );
}

function IdentitySection({
  onOpenClaudeAuth,
  profile,
}: {
  onOpenClaudeAuth: () => void;
  profile: AgentProfileViewModel;
}): React.ReactElement {
  const tone = profile.auth.state === "selected" ? "success" : "warning";
  const stateLabel = profile.auth.state === "selected" ? "Identity ready" : "Needs identity";

  return (
    <section className="grid gap-4" data-testid="agent-profile-panel-identity">
      <section className="rounded-lg border border-subtle bg-canvas/60 p-4">
        <div className="flex items-start gap-3">
          <IconFrame icon={KeyRound} size="sm" tone={tone} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-primary">Claude identity</h3>
            <p className="mt-1 text-sm leading-6 text-secondary text-pretty">
              Auth stays focused on Claude credential health. This profile reads identity status
              from the selected credential without exposing refs or secret values.
            </p>
          </div>
        </div>
      </section>

      <dl className="grid gap-3">
        <DetailFact
          detail={stateLabel}
          icon={BadgeCheck}
          label="Status"
          value={profile.auth.label}
        />
        <DetailFact
          detail={profile.auth.secretSummary}
          icon={KeyRound}
          label="Mode"
          value={profile.auth.modeLabel}
        />
      </dl>

      <Button
        className="min-h-10 justify-start"
        data-testid="agent-profile-panel-open-auth"
        onClick={onOpenClaudeAuth}
        type="button"
        variant="secondary"
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        Manage Claude Auth
      </Button>
    </section>
  );
}

function ToolsSection({
  onOpenProfileTools,
  onOpenProfileWorkspace,
  profile,
}: {
  onOpenProfileTools: () => void;
  onOpenProfileWorkspace: (tab: ProfileWorkspaceTab) => void;
  profile: AgentProfileViewModel;
}): React.ReactElement {
  const tools = profile.capabilities.tools;
  const hasReferencedSecrets = tools.secretStatuses.length > 0;
  const hasMissingSecrets = tools.missingSecretNames.length > 0;

  return (
    <section className="grid gap-4" data-testid="agent-profile-panel-tools">
      <section className="rounded-lg border border-subtle bg-canvas/60 p-4">
        <div className="flex items-start gap-3">
          <IconFrame icon={Blocks} size="sm" tone={hasMissingSecrets ? "warning" : "neutral"} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-primary">Tools and MCP capability</h3>
            <p className="mt-1 text-sm leading-6 text-secondary text-pretty">
              MCP setup is profile capability. This view shows server and secret readiness without
              exposing MCP env/header values, secret refs, or plaintext.
            </p>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3">
        <MetricCard icon={Blocks} label="MCP servers" value={tools.serverNames.length} />
        <MetricCard
          icon={CircleAlert}
          label="Missing secrets"
          value={tools.missingSecretNames.length}
        />
      </dl>

      <SafeList
        empty="No MCP servers configured for this profile."
        icon={Blocks}
        items={tools.serverNames}
        label="Configured MCP servers"
      />

      <section className="rounded-lg border border-subtle bg-canvas/60 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
          Secret readiness
        </h4>
        {hasReferencedSecrets ? (
          <ul className="mt-3 grid gap-2">
            {tools.secretStatuses.map((status) => (
              <li
                className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2 text-sm"
                data-testid={`agent-profile-tool-secret-${status.state}`}
                key={status.name}
              >
                <span className="truncate font-medium text-primary">{status.name}</span>
                <StatusChip tone={status.state === "present" ? "success" : "warning"}>
                  {status.state === "present" ? "Present" : "Missing"}
                </StatusChip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-secondary">No MCP secret references detected.</p>
        )}
      </section>

      <div className="grid gap-2">
        <Button
          className="min-h-10 justify-start"
          data-testid="agent-profile-panel-open-tools-editor"
          onClick={onOpenProfileTools}
          type="button"
          variant="primary"
        >
          <Blocks className="h-4 w-4" aria-hidden="true" />
          Add or edit MCP tools
        </Button>
        <Button
          className="min-h-10 justify-start"
          data-testid="agent-profile-panel-open-layers"
          onClick={() => onOpenProfileWorkspace("layers")}
          type="button"
          variant="secondary"
        >
          <Layers3 className="h-4 w-4" aria-hidden="true" />
          Edit tool configuration in Profile Workspace
        </Button>
      </div>
    </section>
  );
}

function SkillsSection({ profile }: { profile: AgentProfileViewModel }): React.ReactElement {
  const skills = profile.capabilities.skills;

  return (
    <section className="grid gap-4" data-testid="agent-profile-panel-skills">
      <section className="rounded-lg border border-subtle bg-canvas/60 p-4">
        <div className="flex items-start gap-3">
          <IconFrame icon={Code2} size="sm" tone="neutral" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-primary">Skills and persona assets</h3>
            <p className="mt-1 text-sm leading-6 text-secondary text-pretty">
              These counts summarize what the selected profile can bring into Claude without showing
              raw file contents by default.
            </p>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3">
        <MetricCard icon={Sparkles} label="Skills" value={skills.skills} />
        <MetricCard icon={Code2} label="Agents" value={skills.agents} />
        <MetricCard icon={Settings2} label="Slash commands" value={skills.slashCommands} />
        <MetricCard icon={ListChecks} label="Memory" value={skills.memory} />
      </dl>
    </section>
  );
}

function InspectSection({ profile }: { profile: AgentProfileViewModel }): React.ReactElement {
  const scopeLayerCount = profile.details.scopeLayers.length;
  const issueCount = profile.capabilities.tools.validationIssueCount;

  return (
    <section className="grid gap-4" data-testid="agent-profile-panel-inspect">
      <section className="rounded-lg border border-subtle bg-canvas/60 p-4">
        <div className="flex items-start gap-3">
          <IconFrame icon={ListChecks} size="sm" tone={issueCount > 0 ? "warning" : "neutral"} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-primary">Safe inspection summary</h3>
            <p className="mt-1 text-sm leading-6 text-secondary text-pretty">
              Inspect shows counts and health signals only. Exact technical payloads, merge chains,
              MCP values, and secret references stay in dedicated debug surfaces.
            </p>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3">
        <MetricCard icon={Layers3} label="Scope layers" value={scopeLayerCount} />
        <MetricCard icon={CircleAlert} label="Issues" value={issueCount} />
        <MetricCard
          icon={Blocks}
          label="MCP servers"
          value={profile.capabilities.tools.serverNames.length}
        />
        <MetricCard
          icon={Code2}
          label="Persona assets"
          value={profile.capabilities.skills.personaAssets}
        />
      </dl>
    </section>
  );
}

function DetailFact({
  detail,
  icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}): React.ReactElement {
  const Icon = icon;
  return (
    <div className="rounded-lg border border-subtle bg-canvas/60 px-4 py-3">
      <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-tertiary">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 truncate text-sm font-medium text-primary">{value}</dd>
      <dd className="mt-1 truncate text-xs text-secondary">{detail}</dd>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}): React.ReactElement {
  const Icon = icon;
  return (
    <div className="rounded-lg border border-subtle bg-canvas/60 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-tertiary">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold leading-none text-primary tabular-nums">
        {value}
      </div>
    </div>
  );
}

function SafeList({
  empty,
  icon,
  items,
  label,
}: {
  empty: string;
  icon: LucideIcon;
  items: readonly string[];
  label: string;
}): React.ReactElement {
  const Icon = icon;
  return (
    <section className="rounded-lg border border-subtle bg-canvas/60 p-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tertiary">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </h4>
      {items.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              className="rounded-md border border-default bg-surface px-2.5 py-1 text-xs font-medium text-primary"
              key={item}
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-secondary">{empty}</p>
      )}
    </section>
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

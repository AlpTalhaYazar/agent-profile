import { Button, Field, Input } from "@agent-profile/ui";
import {
  AlertTriangle,
  Blocks,
  CheckCircle2,
  Eye,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import type { AgentProfileViewModel } from "../lib/agent-profile-view-model.js";
import { stableStringify } from "../lib/clone.js";
import { normalizeValidationIssues } from "../lib/normalize.js";
import {
  type ProfileMcpSecretRow,
  type ProfileMcpToolDraft,
  type ProfileMcpToolsPreviewSummaryItem,
  type ProfileMcpToolsTarget,
  type ProfileMcpToolsValidationIssue,
  buildProfileMcpToolsPatch,
  createDefaultProfileMcpToolDraft,
  createGitHubProfileMcpToolDraft,
  createProfileMcpToolsDraft,
  createSafeProfileMcpToolsPreviewSummary,
  formatProfileMcpToolsBridgeError,
  resolveProfileMcpToolsTarget,
  shouldGuardProfileMcpToolsClose,
  validateProfileMcpToolsForm,
} from "../lib/profile-mcp-tools.js";
import { mergeValidationIssues, normalizeProfilePreviewResponse } from "../lib/profile-preview.js";
import type {
  DiffItem,
  EffectiveConfig,
  PreviewState,
  ScopeListEntry,
  TransportType,
  ValidationIssue,
  ValidationState,
} from "../lib/types.js";
import { useAnnounce } from "./live-announcer.js";
import { IconFrame, StatusChip } from "./screen-ui.js";

interface ProfileMcpToolsPanelProps {
  currentEffective: EffectiveConfig | null;
  cwd: string;
  onOpenAdvanced: () => void;
  onOpenChange: (open: boolean) => void;
  onPreviewStateChange: (state: PreviewState) => void;
  onRepairMissingSecret: (secretName: string) => void;
  onSaved: (selection: { role: string; authProfileId: string; cwd: string }) => Promise<void>;
  onValidationStateChange: (state: ValidationState) => void;
  open: boolean;
  profile: AgentProfileViewModel;
  scopeEntries: readonly ScopeListEntry[];
  selectedAuthId: string;
  selectedRole: string;
}

type ToolsAsyncStatus = "idle" | "loading" | "ready" | "error";
type ToolsSaveResult = { ok: true } | { ok: false; message: string };

export function ProfileMcpToolsPanel({
  currentEffective,
  cwd,
  onOpenAdvanced,
  onOpenChange,
  onPreviewStateChange,
  onRepairMissingSecret,
  onSaved,
  onValidationStateChange,
  open,
  profile,
  scopeEntries,
  selectedAuthId,
  selectedRole,
}: ProfileMcpToolsPanelProps): React.ReactElement | null {
  const announce = useAnnounce();
  const initialFocusRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const pendingLeaveContinuationRef = React.useRef<(() => void) | null>(null);
  const target = React.useMemo(
    () => resolveProfileMcpToolsTarget({ scopeEntries, selectedRole }),
    [scopeEntries, selectedRole]
  );
  const [draft, setDraft] = React.useState(() => createProfileMcpToolsDraft(target));
  const [baselineSerialized, setBaselineSerialized] = React.useState(() => stableStringify(draft));
  const [bridgeIssues, setBridgeIssues] = React.useState<ValidationIssue[]>([]);
  const [previewStatus, setPreviewStatus] = React.useState<ToolsAsyncStatus>("idle");
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewItems, setPreviewItems] = React.useState<ProfileMcpToolsPreviewSummaryItem[]>([]);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [dirtyPromptOpen, setDirtyPromptOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const nextDraft = createProfileMcpToolsDraft(target);
    setDraft(nextDraft);
    setBaselineSerialized(stableStringify(nextDraft));
    setBridgeIssues([]);
    setPreviewStatus("idle");
    setPreviewError(null);
    setPreviewItems([]);
    setSaveError(null);
    setDirtyPromptOpen(false);
    announce("Guided Profile Tools opened");
    const frameId = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [announce, open, target]);

  const formValidation = React.useMemo(
    () => validateProfileMcpToolsForm({ target, draft }),
    [draft, target]
  );
  const issues = React.useMemo(
    () => [...formValidation.issues, ...bridgeIssues.map(toProfileMcpToolsIssue)],
    [bridgeIssues, formValidation.issues]
  );
  const issuesByField = React.useMemo(() => mapToolsIssuesByField(issues), [issues]);
  const currentSerialized = stableStringify(draft);
  const isDirty = open && currentSerialized !== baselineSerialized;
  const hasSelection = Boolean(selectedRole.trim() && selectedAuthId.trim() && cwd.trim());
  const hasBlockingIssues = issues.length > 0 || previewStatus === "error" || !hasSelection;
  const saveDisabledReason = getProfileMcpToolsSaveDisabledReason({
    hasBlockingIssues,
    hasSelection,
    isSaving,
    previewStatus,
    targetStatus: target.status,
  });
  const saveDisabled = Boolean(saveDisabledReason);
  const canSaveTools = isDirty && !saveDisabled;

  React.useEffect(() => {
    if (!open) return;
    onValidationStateChange({
      status: formValidation.ok && hasSelection ? "ready" : "ready",
      issues: formValidation.issues.map(toValidationIssue),
      errorMessage: null,
    });
    if (!formValidation.ok || target.status !== "writable") {
      onPreviewStateChange({ status: "idle", effective: null, diff: [], errorMessage: null });
    }
  }, [
    formValidation,
    hasSelection,
    onPreviewStateChange,
    onValidationStateChange,
    open,
    target.status,
  ]);

  const resetPanelState = React.useCallback(() => {
    pendingLeaveContinuationRef.current = null;
    setDirtyPromptOpen(false);
    setSaveError(null);
    setBridgeIssues([]);
    setPreviewStatus("idle");
    setPreviewError(null);
    setPreviewItems([]);
    onValidationStateChange({ status: "idle", issues: [], errorMessage: null });
    onPreviewStateChange({ status: "idle", effective: null, diff: [], errorMessage: null });
  }, [onPreviewStateChange, onValidationStateChange]);

  const completeClose = React.useCallback(
    (announceClosed = true) => {
      resetPanelState();
      onOpenChange(false);
      if (announceClosed) announce("Guided Profile Tools closed");
    },
    [announce, onOpenChange, resetPanelState]
  );

  const completeCloseAndContinue = React.useCallback(
    (continuation: (() => void) | null, announceClosed = true) => {
      completeClose(announceClosed);
      window.setTimeout(() => continuation?.(), 0);
    },
    [completeClose]
  );

  const requestLeave = React.useCallback(
    (continuation: (() => void) | null = null) => {
      if (shouldGuardProfileMcpToolsClose({ isDirty, isSaving })) {
        pendingLeaveContinuationRef.current = continuation;
        setDirtyPromptOpen(true);
        announce("Profile Tools has unsaved changes");
        return;
      }
      completeCloseAndContinue(continuation);
    },
    [announce, completeCloseAndContinue, isDirty, isSaving]
  );

  const updateDraft = React.useCallback((updater: (current: typeof draft) => typeof draft) => {
    setSaveError(null);
    setBridgeIssues([]);
    setPreviewStatus("idle");
    setPreviewError(null);
    setPreviewItems([]);
    setDraft(updater);
  }, []);

  const handleAddGitHub = React.useCallback(() => {
    updateDraft((current) => ({
      ...current,
      tools: [...current.tools, createGitHubProfileMcpToolDraft()],
    }));
  }, [updateDraft]);

  const handleAddBlank = React.useCallback(() => {
    updateDraft((current) => ({
      ...current,
      tools: [
        ...current.tools,
        createDefaultProfileMcpToolDraft({ name: uniqueDraftToolName(current.tools) }),
      ],
    }));
  }, [updateDraft]);

  const handlePreview = React.useCallback(async () => {
    const patch = buildProfileMcpToolsPatch({ target, draft });
    if (!patch.ok) {
      const safeIssues = patch.issues.map(toValidationIssue);
      setBridgeIssues([]);
      setPreviewStatus("idle");
      setPreviewError(null);
      setPreviewItems([]);
      onValidationStateChange({ status: "ready", issues: safeIssues, errorMessage: null });
      onPreviewStateChange({ status: "idle", effective: null, diff: [], errorMessage: null });
      announce("Profile Tools needs field fixes before preview");
      return;
    }

    const baselineContent = target.status === "writable" ? target.content : null;
    const profileApi = window.myclaude?.profile;
    if (!profileApi?.validate || !profileApi.preview) {
      const message = "Profile Tools preview is unavailable right now.";
      setPreviewStatus("error");
      setPreviewError(message);
      setPreviewItems(createSafeProfileMcpToolsPreviewSummary(baselineContent, patch.content));
      onPreviewStateChange({ status: "error", effective: null, diff: [], errorMessage: message });
      announce("Profile Tools preview failed");
      return;
    }

    setPreviewStatus("loading");
    setPreviewError(null);
    setSaveError(null);
    onPreviewStateChange({ status: "loading", effective: null, diff: [], errorMessage: null });
    try {
      const [validationResult, previewResult] = await Promise.all([
        profileApi.validate({ content: patch.content }),
        profileApi.preview({
          role: selectedRole,
          authProfileId: selectedAuthId,
          cwd,
          draft: { path: patch.path, content: patch.content },
        }),
      ]);
      const validationIssues = sanitizeValidationIssues(
        normalizeValidationIssues(validationResult)
      );
      const preview = normalizeProfilePreviewResponse(previewResult, {
        currentEffective,
        createDiffSummary: createSafeMcpToolsEffectiveDiff,
      });
      const previewIssues = sanitizeValidationIssues(preview.issues);
      const mergedIssues = mergeValidationIssues(validationIssues, previewIssues);
      const summary = createSafeProfileMcpToolsPreviewSummary(baselineContent, patch.content);
      setBridgeIssues(mergedIssues);
      setPreviewItems(summary);
      onValidationStateChange({ status: "ready", issues: mergedIssues, errorMessage: null });

      if (preview.status === "error") {
        const message =
          "Profile Tools preview could not be prepared. Review the fields and try again.";
        setPreviewStatus("error");
        setPreviewError(message);
        onPreviewStateChange({ status: "error", effective: null, diff: [], errorMessage: message });
        announce("Profile Tools preview needs attention");
        return;
      }

      setPreviewStatus("ready");
      setPreviewError(null);
      onPreviewStateChange({
        status: "ready",
        effective: preview.effective,
        diff: createSafeMcpToolsEffectiveDiff(currentEffective, preview.effective),
        errorMessage: null,
      });
      announce(
        summary.length > 0 ? "Profile Tools preview ready" : "Profile Tools preview has no changes"
      );
    } catch (error) {
      const message = formatProfileMcpToolsBridgeError(
        error,
        "Profile Tools preview could not be prepared. Review the fields and try again."
      );
      setBridgeIssues([]);
      setPreviewStatus("error");
      setPreviewError(message);
      setPreviewItems(createSafeProfileMcpToolsPreviewSummary(baselineContent, patch.content));
      onValidationStateChange({ status: "error", issues: [], errorMessage: message });
      onPreviewStateChange({ status: "error", effective: null, diff: [], errorMessage: message });
      announce("Profile Tools preview failed");
    }
  }, [
    announce,
    currentEffective,
    cwd,
    draft,
    onPreviewStateChange,
    onValidationStateChange,
    selectedAuthId,
    selectedRole,
    target,
  ]);

  const saveToolsDraft = React.useCallback(async (): Promise<ToolsSaveResult> => {
    const patch = buildProfileMcpToolsPatch({ target, draft });
    if (!patch.ok) {
      const message = "Fix the highlighted Tools fields before saving.";
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }
    if (!hasSelection) {
      const message = "Choose a valid Agent Profile before saving tools.";
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }
    const profileApi = window.myclaude?.profile;
    if (!profileApi?.save) {
      const message = "Profile Tools save is unavailable right now.";
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await profileApi.save({ path: patch.path, content: patch.content });
      await onSaved({ role: selectedRole, authProfileId: selectedAuthId, cwd });
      setBaselineSerialized(stableStringify(draft));
      announce("Guided Profile Tools saved");
      return { ok: true };
    } catch (error) {
      const message = formatProfileMcpToolsBridgeError(
        error,
        "Profile Tools could not be saved. Review the fields and try again."
      );
      setSaveError(message);
      announce(`Profile Tools save failed: ${message}`);
      return { ok: false, message };
    } finally {
      setIsSaving(false);
    }
  }, [announce, cwd, draft, hasSelection, onSaved, selectedAuthId, selectedRole, target]);

  const handleSave = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const result = await saveToolsDraft();
      if (result.ok) completeClose(false);
    },
    [completeClose, saveToolsDraft]
  );

  const cancelDirtyPrompt = React.useCallback(() => {
    setDirtyPromptOpen(false);
    announce("Stayed in guided Profile Tools.");
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
  }, [announce]);

  const discardDirtyPromptAndContinue = React.useCallback(() => {
    const continuation = pendingLeaveContinuationRef.current;
    announce("Discarded Profile Tools changes.");
    completeCloseAndContinue(continuation);
  }, [announce, completeCloseAndContinue]);

  const saveDirtyPromptAndContinue = React.useCallback(async () => {
    const continuation = pendingLeaveContinuationRef.current;
    const result = await saveToolsDraft();
    if (!result.ok) return;
    completeCloseAndContinue(continuation, false);
  }, [completeCloseAndContinue, saveToolsDraft]);

  const handleRepairMissingSecret = React.useCallback(
    (secretName: string) => {
      if (!isSafeRepairSecretName(secretName)) {
        announce("Profile Tools cannot repair an unsafe MCP secret reference.");
        return;
      }
      requestLeave(() => onRepairMissingSecret(secretName));
    },
    [announce, onRepairMissingSecret, requestLeave]
  );

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (dirtyPromptOpen) {
        cancelDirtyPrompt();
        return;
      }
      requestLeave(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelDirtyPrompt, dirtyPromptOpen, open, requestLeave]);

  const targetTone =
    target.status === "writable" ? "success" : target.status === "invalid" ? "danger" : "warning";
  const previewTone =
    previewStatus === "ready"
      ? previewItems.length > 0
        ? "info"
        : "success"
      : previewStatus === "error"
        ? "danger"
        : previewStatus === "loading"
          ? "warning"
          : "neutral";
  const targetMessage =
    target.status === "writable"
      ? "Guided Tools will update MCP servers on the selected Agent Profile only."
      : target.message;
  const missingToolSecretNames = profile.capabilities.tools.missingSecretNames;
  const repairSecretRows = React.useMemo(
    () =>
      missingToolSecretNames.map((secretName, index) => {
        const repairable = isSafeRepairSecretName(secretName);
        return {
          id: repairable ? toSafeTestId(secretName) : `unsafe-${index + 1}`,
          rawName: secretName,
          displayName: repairable ? secretName : "Unsafe MCP secret reference",
          repairable,
        };
      }),
    [missingToolSecretNames]
  );
  const authRepairAvailable = Boolean(selectedAuthId.trim() && hasAuthSetSecretBridge());

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm" aria-hidden="true" />
      <dialog
        aria-labelledby="profile-tools-title"
        className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-full max-w-6xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-lg"
        data-testid="profile-tools-panel"
        onCancel={(event: React.SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault();
          requestLeave(null);
        }}
        open
      >
        <form className="flex max-h-[92vh] min-h-0 flex-col" onSubmit={handleSave}>
          <header className="border-b border-subtle bg-surface/95 px-6 py-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <IconFrame icon={Blocks} size="sm" tone="accent" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
                    Guided Tools
                  </p>
                  <h2
                    className="mt-1 text-xl font-semibold tracking-[-0.02em] text-primary"
                    id="profile-tools-title"
                  >
                    Add MCP tools to {profile.name}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-secondary">
                    Configure MCP servers with logical secret names. Secret values stay in Auth and
                    never appear here.
                  </p>
                </div>
              </div>
              <Button
                aria-label="Close Profile Tools"
                className="min-h-10 min-w-10 shrink-0"
                onClick={() => requestLeave(null)}
                type="button"
                variant="ghost"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </header>

          <div className="app-scrollbar grid min-h-0 flex-1 gap-0 overflow-auto lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]">
            <div className="grid gap-5 px-6 py-5">
              <section className="rounded-xl border border-default bg-canvas/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-primary">Target status</h3>
                    <p className="mt-1 text-sm leading-6 text-secondary">{targetMessage}</p>
                  </div>
                  <StatusChip tone={targetTone}>
                    {target.status === "writable" ? "Ready to edit" : "Needs advanced edit"}
                  </StatusChip>
                </div>
                {target.status !== "writable" ? (
                  <div className="mt-4">
                    <Button
                      data-testid="profile-tools-open-advanced"
                      onClick={onOpenAdvanced}
                      type="button"
                      variant="secondary"
                    >
                      Open Profile Workspace
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-default bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">MCP server list</h3>
                    <p className="mt-1 text-sm leading-6 text-secondary">
                      Start with GitHub, or add a blank server for another MCP provider.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={target.status !== "writable" || isSaving}
                      onClick={handleAddGitHub}
                      ref={initialFocusRef}
                      type="button"
                      variant="secondary"
                      data-testid="profile-tools-add-github"
                    >
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Add GitHub tool
                    </Button>
                    <Button
                      disabled={target.status !== "writable" || isSaving}
                      onClick={handleAddBlank}
                      type="button"
                      variant="secondary"
                      data-testid="profile-tools-add-blank"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add blank
                    </Button>
                  </div>
                </div>

                {draft.tools.length > 0 ? (
                  <div className="mt-4 grid gap-4" data-testid="profile-tools-list">
                    {draft.tools.map((tool, index) => (
                      <ToolDraftCard
                        disabled={target.status !== "writable" || isSaving}
                        issuesByField={issuesByField}
                        key={tool.id}
                        onChange={(nextTool) =>
                          updateDraft((current) => ({
                            ...current,
                            tools: current.tools.map((candidate) =>
                              candidate.id === tool.id ? nextTool : candidate
                            ),
                          }))
                        }
                        onDelete={() =>
                          updateDraft((current) => ({
                            ...current,
                            tools: current.tools.filter((candidate) => candidate.id !== tool.id),
                          }))
                        }
                        tool={tool}
                        toolIndex={index}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className="mt-4 rounded-lg border border-dashed border-subtle bg-canvas/60 px-4 py-8 text-sm text-secondary"
                    data-testid="profile-tools-empty"
                  >
                    No profile-owned MCP tools yet. Add a GitHub tool to start with a logical secret
                    named github.pat.
                  </div>
                )}
              </section>
            </div>

            <aside className="border-t border-subtle bg-canvas/65 px-6 py-5 lg:border-l lg:border-t-0">
              <section
                aria-live="polite"
                className="sticky top-0 grid gap-4"
                data-testid="profile-tools-preview"
              >
                <div className="rounded-xl border border-default bg-surface p-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <IconFrame
                      icon={previewStatus === "error" ? AlertTriangle : Eye}
                      size="sm"
                      tone={previewStatus === "error" ? "danger" : "accent"}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-primary">Preview impact</h3>
                        <StatusChip tone={previewTone}>
                          {formatPreviewStatus(previewStatus)}
                        </StatusChip>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-secondary">
                        {previewStatus === "loading"
                          ? "Checking the guided Tools draft…"
                          : previewStatus === "error"
                            ? previewError
                            : issues.length > 0 || !hasSelection
                              ? "Fix validation issues to preview safely."
                              : previewItems.length > 0
                                ? `${previewItems.length} safe Tools change${previewItems.length === 1 ? "" : "s"} ready to review.`
                                : "No Tools preview has been requested yet."}
                      </p>
                    </div>
                  </div>
                  {previewItems.length > 0 ? (
                    <ul className="mt-4 grid gap-2">
                      {previewItems.slice(0, 12).map((item, index) => (
                        <li
                          className="rounded-md border border-subtle bg-canvas/70 px-3 py-2 text-sm text-secondary"
                          key={`${item.name}:${item.change}:${index}`}
                        >
                          <span className="font-medium text-primary">
                            {formatPreviewChange(item.change)}
                          </span>{" "}
                          MCP tool · {item.name} · {item.transport} · {item.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="rounded-xl border border-default bg-surface p-4">
                  <h3 className="text-sm font-semibold text-primary">Save readiness</h3>
                  <ul className="mt-3 grid gap-2 text-sm text-secondary">
                    <ReadinessLine ok={target.status === "writable"}>
                      Writable profile target
                    </ReadinessLine>
                    <ReadinessLine ok={hasSelection}>
                      Selected profile still available
                    </ReadinessLine>
                    <ReadinessLine ok={!issuesByField.name}>Unique safe server names</ReadinessLine>
                    <ReadinessLine ok={!issuesByField.commandOrUrl && !issuesByField.transport}>
                      Valid transport endpoint
                    </ReadinessLine>
                    <ReadinessLine ok={!issuesByField.env && !issuesByField.headers}>
                      Logical secret names only
                    </ReadinessLine>
                  </ul>
                </div>

                {repairSecretRows.length > 0 ? (
                  <div
                    className="rounded-xl border border-default bg-surface p-4"
                    data-testid="profile-tools-auth-repair"
                  >
                    <h3 className="text-sm font-semibold text-primary">Auth repair</h3>
                    <p className="mt-2 text-sm leading-6 text-secondary">
                      These MCP tools reference logical secrets that are missing from the selected
                      Claude identity. Repair opens Auth with the logical name only.
                    </p>
                    <ul className="mt-3 grid gap-2">
                      {repairSecretRows.map((row) => (
                        <li
                          className="flex items-center justify-between gap-3 rounded-md border border-subtle bg-canvas/70 px-3 py-2 text-sm"
                          key={row.id}
                        >
                          <span className="truncate font-mono text-xs text-primary">
                            {row.displayName}
                          </span>
                          <Button
                            data-testid={`profile-tools-repair-secret-${row.id}`}
                            disabled={!authRepairAvailable || !row.repairable}
                            onClick={() => handleRepairMissingSecret(row.rawName)}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Repair in Auth
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {repairSecretRows.some((row) => !row.repairable) ? (
                      <p className="mt-3 rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning">
                        One MCP secret reference is unsafe for guided repair. Open Profile Workspace
                        to replace it with a logical name such as github.pat.
                      </p>
                    ) : null}
                    {!authRepairAvailable ? (
                      <p className="mt-3 rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-xs text-status-warning">
                        Auth support is unavailable for this profile. Open Claude Auth when the
                        bridge is available to add or update the missing tool secret.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {issues.length > 0 || saveError || !hasSelection || target.status !== "writable" ? (
                  <div
                    className="rounded-xl border border-status-danger bg-status-danger-soft p-4 text-sm text-status-danger"
                    data-testid="profile-tools-error"
                    role="alert"
                  >
                    <p className="font-semibold">Tools needs attention</p>
                    <ul className="mt-2 grid gap-1">
                      {target.status !== "writable" ? <li>{target.message}</li> : null}
                      {!hasSelection ? (
                        <li>Choose a valid Agent Profile before saving tools.</li>
                      ) : null}
                      {issues.slice(0, 5).map((issue, index) => (
                        <li key={`${issue.path}:${index}`}>{issue.message}</li>
                      ))}
                      {saveError ? <li>{saveError}</li> : null}
                    </ul>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>

          <div className="flex flex-row flex-wrap justify-end gap-2 border-t border-subtle bg-surface/95 px-6 py-4">
            <Button
              data-testid="profile-tools-cancel"
              disabled={isSaving}
              onClick={() => requestLeave(null)}
              ref={cancelButtonRef}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              data-testid="profile-tools-preview-action"
              disabled={
                target.status !== "writable" ||
                isSaving ||
                !hasSelection ||
                formValidation.issues.length > 0
              }
              onClick={() => void handlePreview()}
              type="button"
              variant="secondary"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Preview Tools
            </Button>
            <Button
              data-testid="profile-tools-save"
              disabled={saveDisabled}
              type="submit"
              variant="primary"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSaving ? "Saving…" : "Save Tools"}
            </Button>
          </div>
        </form>
      </dialog>

      {dirtyPromptOpen ? (
        <>
          <div className="fixed inset-0 z-[60] bg-overlay/80 backdrop-blur-sm" aria-hidden="true" />
          <dialog
            aria-labelledby="profile-tools-dirty-title"
            className="fixed left-1/2 top-1/2 z-[61] grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border border-border bg-popover p-6 text-popover-foreground shadow-lg"
            data-testid="profile-tools-dirty-dialog"
            onCancel={(event: React.SyntheticEvent<HTMLDialogElement>) => {
              event.preventDefault();
              cancelDirtyPrompt();
            }}
            open
          >
            <header className="flex flex-col gap-1.5">
              <h2
                className="text-base font-semibold text-foreground"
                id="profile-tools-dirty-title"
              >
                Save Profile Tools changes?
              </h2>
              <p className="text-sm text-muted-foreground">
                You have unsaved guided Tools edits. Save before leaving, discard the draft, or stay
                here to keep editing.
              </p>
            </header>
            {saveDisabledReason ? (
              <p className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning">
                {saveDisabledReason}
              </p>
            ) : null}
            {saveError ? (
              <p
                className="rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger"
                role="alert"
              >
                {saveError}
              </p>
            ) : null}
            <div className="flex flex-row flex-wrap justify-end gap-2">
              <Button
                data-testid="profile-tools-dirty-cancel"
                disabled={isSaving}
                onClick={cancelDirtyPrompt}
                type="button"
                variant="ghost"
              >
                Keep editing
              </Button>
              <Button
                data-testid="profile-tools-dirty-discard"
                disabled={isSaving}
                onClick={discardDirtyPromptAndContinue}
                type="button"
                variant="secondary"
              >
                Discard changes
              </Button>
              <Button
                data-testid="profile-tools-dirty-save"
                disabled={!canSaveTools || isSaving}
                onClick={() => void saveDirtyPromptAndContinue()}
                type="button"
                variant="primary"
              >
                {isSaving ? "Saving…" : "Save Tools"}
              </Button>
            </div>
          </dialog>
        </>
      ) : null}
    </>
  );
}

function ToolDraftCard({
  disabled,
  issuesByField,
  onChange,
  onDelete,
  tool,
  toolIndex,
}: {
  disabled: boolean;
  issuesByField: Partial<Record<ProfileMcpToolsValidationIssue["field"], string>>;
  onChange: (tool: ProfileMcpToolDraft) => void;
  onDelete: () => void;
  tool: ProfileMcpToolDraft;
  toolIndex: number;
}): React.ReactElement {
  const isRemote = tool.transport !== "stdio";
  return (
    <section
      className="rounded-lg border border-subtle bg-canvas/60 p-4"
      data-testid="profile-tools-tool-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-primary">MCP tool {toolIndex + 1}</h4>
          <p className="mt-1 text-sm text-secondary">
            Use logical secret names such as github.pat; do not paste token values.
          </p>
        </div>
        <Button
          aria-label={`Delete MCP tool ${toolIndex + 1}`}
          className="min-h-10"
          disabled={disabled}
          onClick={onDelete}
          type="button"
          variant="ghost"
          data-testid="profile-tools-delete-tool"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      </div>
      {tool.hiddenAdvancedFieldCount > 0 ? (
        <p className="mt-3 rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning">
          {tool.hiddenAdvancedFieldCount} advanced value
          {tool.hiddenAdvancedFieldCount === 1 ? "" : "s"} hidden. Open Profile Workspace before
          saving this tool.
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_11rem]">
        <Field
          label="Server name"
          htmlFor={`${tool.id}-name`}
          {...fieldErrorProps(issuesByField.name)}
        >
          <Input
            disabled={disabled}
            id={`${tool.id}-name`}
            onChange={(event) => onChange({ ...tool, name: event.currentTarget.value })}
            value={tool.name}
            data-testid="profile-tools-server-name"
          />
        </Field>
        <Field label="Transport" {...fieldErrorProps(issuesByField.transport)}>
          <select
            aria-label={`MCP tool ${toolIndex + 1} transport`}
            className="min-h-10 rounded-md border border-default bg-canvas px-3 text-sm text-primary shadow-xs focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...tool, transport: event.currentTarget.value as TransportType })
            }
            value={tool.transport}
            data-testid="profile-tools-transport"
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="streamable-http">streamable-http</option>
            <option value="sse">sse</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Field
          label={isRemote ? "URL" : "Command"}
          htmlFor={`${tool.id}-command-or-url`}
          description={
            isRemote
              ? "Use an http or https MCP endpoint."
              : "Use the command name, not a token or secret reference."
          }
          {...fieldErrorProps(issuesByField.commandOrUrl)}
        >
          <Input
            className={isRemote ? "" : "font-mono text-xs"}
            disabled={disabled}
            id={`${tool.id}-command-or-url`}
            onChange={(event) => onChange({ ...tool, commandOrUrl: event.currentTarget.value })}
            placeholder={isRemote ? "https://example.test/mcp" : "npx"}
            value={tool.commandOrUrl}
            data-testid="profile-tools-command-url"
          />
        </Field>
        <Field
          label="Args"
          htmlFor={`${tool.id}-args`}
          description="One argument per line. Keep credentials in logical secrets."
          {...fieldErrorProps(issuesByField.args)}
        >
          <textarea
            className="min-h-24 rounded-md border border-default bg-canvas px-3 py-2 font-mono text-xs text-primary shadow-xs focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || isRemote}
            id={`${tool.id}-args`}
            onChange={(event) => onChange({ ...tool, argsText: event.currentTarget.value })}
            value={tool.argsText}
            data-testid="profile-tools-args"
          />
        </Field>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <SecretRowsEditor
          disabled={disabled}
          error={issuesByField.env}
          label="Environment logical secrets"
          onChange={(envRows) => onChange({ ...tool, envRows })}
          rows={tool.envRows}
          testId="profile-tools-env-rows"
        />
        <SecretRowsEditor
          disabled={disabled || !isRemote}
          error={issuesByField.headers}
          label="Header logical secrets"
          onChange={(headerRows) => onChange({ ...tool, headerRows })}
          rows={tool.headerRows}
          testId="profile-tools-header-rows"
        />
      </div>
    </section>
  );
}

function SecretRowsEditor({
  disabled,
  error,
  label,
  onChange,
  rows,
  testId,
}: {
  disabled: boolean;
  error: string | undefined;
  label: string;
  onChange: (rows: ProfileMcpSecretRow[]) => void;
  rows: readonly ProfileMcpSecretRow[];
  testId: string;
}): React.ReactElement {
  return (
    <section className="rounded-lg border border-subtle bg-surface p-3" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-tertiary">{label}</h5>
          <p className="mt-1 text-xs text-secondary">
            The value is a logical Auth secret name, not the secret itself.
          </p>
        </div>
        <Button
          disabled={disabled}
          onClick={() => onChange([...rows, { id: createLocalId(), key: "", secretName: "" }])}
          type="button"
          variant="secondary"
        >
          Add
        </Button>
      </div>
      {error ? (
        <p className="mt-2 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {rows.map((row, index) => (
            <div
              className="grid gap-2 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_auto]"
              key={row.id}
            >
              <Input
                aria-label={`${label} ${index + 1} field`}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    rows.map((candidate) =>
                      candidate.id === row.id
                        ? { ...candidate, key: event.currentTarget.value }
                        : candidate
                    )
                  )
                }
                placeholder="Authorization"
                value={row.key}
              />
              <Input
                aria-label={`${label} ${index + 1} secret name`}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    rows.map((candidate) =>
                      candidate.id === row.id
                        ? { ...candidate, secretName: event.currentTarget.value }
                        : candidate
                    )
                  )
                }
                placeholder="github.pat"
                value={row.secretName}
              />
              <Button
                aria-label={`Remove ${label} ${index + 1}`}
                className="min-h-10"
                disabled={disabled}
                onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-secondary">No logical secrets configured here.</p>
      )}
    </section>
  );
}

function mapToolsIssuesByField(
  issues: readonly { field: ProfileMcpToolsValidationIssue["field"]; message: string }[]
): Partial<Record<ProfileMcpToolsValidationIssue["field"], string>> {
  const byField: Partial<Record<ProfileMcpToolsValidationIssue["field"], string>> = {};
  for (const issue of issues) byField[issue.field] ??= issue.message;
  return byField;
}

function toProfileMcpToolsIssue(issue: ValidationIssue): ProfileMcpToolsValidationIssue {
  return { field: "target", path: issue.path, message: issue.message, severity: "error" };
}

function toValidationIssue(issue: ProfileMcpToolsValidationIssue): ValidationIssue {
  return { path: safeIssuePath(issue.path), message: issue.message, severity: issue.severity };
}

function sanitizeValidationIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue, index) => ({
    path: safeIssuePath(issue.path || `profile-tools.${index + 1}`),
    severity: issue.severity || "error",
    message: safeValidationMessage(issue),
  }));
}

function safeIssuePath(path: string): string {
  if (/keyring:\/\/|\$\{secret:|secretRef|bearer\s+|token|authorization/i.test(path))
    return "profile-tools";
  return path || "profile-tools";
}

function safeValidationMessage(issue: ValidationIssue): string {
  if (/mcp|server|tool/i.test(issue.path))
    return "Profile Tools needs a safe MCP server value before saving.";
  return "Profile Tools needs a safe value before saving.";
}

function createSafeMcpToolsEffectiveDiff(
  current: EffectiveConfig | null,
  preview: EffectiveConfig | null
): DiffItem[] {
  if (!current || !preview) return [];
  const items: DiffItem[] = [];
  for (const key of Array.from(
    new Set([...Object.keys(current.mcpServers), ...Object.keys(preview.mcpServers)])
  ).sort()) {
    const before = current.mcpServers[key];
    const after = preview.mcpServers[key];
    if (stableStringify(before) === stableStringify(after)) continue;
    items.push({
      section: "mcpServers",
      key: safeDiffKey(key),
      change: before === undefined ? "added" : after === undefined ? "removed" : "changed",
    });
  }
  return items;
}

function safeDiffKey(value: string): string {
  if (/secret|token|authorization|api[_-]?key|keyring|bearer/i.test(value)) return "MCP tool";
  return value || "MCP tool";
}

function getProfileMcpToolsSaveDisabledReason(input: {
  targetStatus: ProfileMcpToolsTarget["status"];
  hasBlockingIssues: boolean;
  hasSelection: boolean;
  isSaving: boolean;
  previewStatus: ToolsAsyncStatus;
}): string | null {
  if (input.targetStatus !== "writable") return "Profile Tools needs a writable profile target.";
  if (!input.hasSelection) return "Choose a valid Agent Profile before saving tools.";
  if (input.hasBlockingIssues) return "Fix the highlighted Tools fields before saving.";
  if (input.previewStatus === "loading")
    return "Wait for Profile Tools preview to finish checking.";
  if (input.isSaving) return "Profile Tools is saving.";
  return null;
}

function fieldErrorProps(
  error: string | null | undefined
): { error: string } | Record<string, never> {
  return error ? { error } : {};
}

function formatPreviewStatus(status: ToolsAsyncStatus): string {
  if (status === "loading") return "Checking";
  if (status === "ready") return "Ready";
  if (status === "error") return "Needs attention";
  return "Waiting";
}

function formatPreviewChange(change: ProfileMcpToolsPreviewSummaryItem["change"]): string {
  if (change === "added") return "Adds";
  if (change === "removed") return "Removes";
  return "Changes";
}

function ReadinessLine({
  children,
  ok,
}: { children: React.ReactNode; ok: boolean }): React.ReactElement {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-status-warning" aria-hidden="true" />
      )}
      <span className={ok ? "text-secondary" : "text-status-warning"}>{children}</span>
    </li>
  );
}

function uniqueDraftToolName(tools: readonly ProfileMcpToolDraft[]): string {
  let index = 1;
  let candidate = "server";
  const names = new Set(tools.map((tool) => tool.name));
  while (names.has(candidate)) {
    index += 1;
    candidate = `server-${index}`;
  }
  return candidate;
}

function hasAuthSetSecretBridge(): boolean {
  return typeof window !== "undefined" && typeof window.myclaude?.auth?.setSecret === "function";
}

function isSafeRepairSecretName(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(value) &&
    !value.includes("//") &&
    !/keyring:|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|authorization|oauth|client[_-]?secret|refresh[_-]?token|access[_-]?token|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/i.test(
      value
    )
  );
}

function toSafeTestId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "secret"
  );
}

function createLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
}

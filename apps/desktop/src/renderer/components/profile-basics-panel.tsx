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
  cn,
} from "@agent-profile/ui";
import { useSetAtom } from "jotai";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FolderOpen,
  KeyRound,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { sanitizeProfileLabel, type ProfileIdentitySelection } from "../lib/profile-identity.js";
import {
  buildProfileBasicsPatch,
  createProfileBasicsDraft,
  createProfileBasicsEnvRows,
  createSafeProfileBasicsPreviewSummary,
  formatProfileBasicsBridgeError,
  resolveProfileBasicsTarget,
  shouldGuardProfileBasicsClose,
  validateProfileBasicsForm,
  type ProfileBasicsDraft,
  type ProfileBasicsEnvRow,
  type ProfileBasicsPreviewSummaryItem,
  type ProfileBasicsTarget,
} from "../lib/profile-basics.js";
import { stableStringify } from "../lib/clone.js";
import { profileBasicsNavigationGuardAtom } from "../lib/atoms.js";
import type { AgentProfileViewModel } from "../lib/agent-profile-view-model.js";
import { normalizeValidationIssues } from "../lib/normalize.js";
import { mergeValidationIssues, normalizeProfilePreviewResponse } from "../lib/profile-preview.js";
import type {
  AuthProfileOption,
  DiffItem,
  EffectiveConfig,
  PreviewState,
  ScopeListEntry,
  ValidationIssue,
  ValidationState,
} from "../lib/types.js";
import { useAnnounce } from "./live-announcer.js";
import { IconFrame, StatusChip } from "./screen-ui.js";

interface ProfileBasicsPanelProps {
  authProfiles: readonly AuthProfileOption[];
  currentEffective: EffectiveConfig | null;
  cwd: string;
  onOpenAdvanced: () => void;
  onOpenChange: (open: boolean) => void;
  onOpenClaudeAuth: () => void;
  onPreviewStateChange: (state: PreviewState) => void;
  onSaved: (selection: ProfileIdentitySelection) => Promise<void>;
  onValidationStateChange: (state: ValidationState) => void;
  open: boolean;
  profile: AgentProfileViewModel;
  scopeEntries: readonly ScopeListEntry[];
  selectedAuthId: string;
  selectedRole: string;
}

type BasicsAsyncStatus = "idle" | "loading" | "ready" | "error";
type BasicsSaveResult = { ok: true } | { ok: false; message: string };

export function ProfileBasicsPanel({
  authProfiles,
  currentEffective,
  cwd,
  onOpenAdvanced,
  onOpenChange,
  onOpenClaudeAuth,
  onPreviewStateChange,
  onSaved,
  onValidationStateChange,
  open,
  profile,
  scopeEntries,
  selectedAuthId,
  selectedRole,
}: ProfileBasicsPanelProps): React.ReactElement {
  const announce = useAnnounce();
  const setBasicsNavigationGuard = useSetAtom(profileBasicsNavigationGuardAtom);
  const initialFocusRef = React.useRef<HTMLInputElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const pendingLeaveContinuationRef = React.useRef<(() => void) | null>(null);
  const [draft, setDraft] = React.useState<ProfileBasicsDraft>(() =>
    createPanelDraft(scopeEntries, selectedRole, profile, selectedAuthId, cwd)
  );
  const [envRows, setEnvRows] = React.useState<ProfileBasicsEnvRow[]>(() =>
    createProfileBasicsEnvRows(draft.env)
  );
  const [baselineSerialized, setBaselineSerialized] = React.useState(() =>
    serializeBasicsForm(draft, envRows)
  );
  const [pickerError, setPickerError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [bridgeIssues, setBridgeIssues] = React.useState<ValidationIssue[]>([]);
  const [previewStatus, setPreviewStatus] = React.useState<BasicsAsyncStatus>("idle");
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewItems, setPreviewItems] = React.useState<ProfileBasicsPreviewSummaryItem[]>([]);
  const [dirtyPromptOpen, setDirtyPromptOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const target = React.useMemo(
    () => resolveProfileBasicsTarget({ scopeEntries, selectedRole }),
    [scopeEntries, selectedRole]
  );

  React.useEffect(() => {
    if (!open) return;
    const nextDraft = createProfileBasicsDraft(target, {
      role: selectedRole,
      authProfileId: selectedAuthId,
      cwd,
      displayName: profile.name,
      purpose: profile.purposeLabel,
    });
    const nextRows = createProfileBasicsEnvRows(nextDraft.env);
    setDraft(nextDraft);
    setEnvRows(nextRows);
    setBaselineSerialized(serializeBasicsForm(nextDraft, nextRows));
    setPickerError(null);
    setSaveError(null);
    setBridgeIssues([]);
    setPreviewStatus("idle");
    setPreviewError(null);
    setPreviewItems([]);
    setDirtyPromptOpen(false);
    announce("Guided Profile Basics opened");
    const frameId = window.requestAnimationFrame(() => {
      initialFocusRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    announce,
    cwd,
    open,
    profile.name,
    profile.purposeLabel,
    selectedAuthId,
    selectedRole,
    target,
  ]);

  const formValidation = React.useMemo(
    () => validateProfileBasicsForm({ target, draft, envRows, authProfiles }),
    [authProfiles, draft, envRows, target]
  );
  const issues = React.useMemo(
    () => [...formValidation.issues, ...bridgeIssues.map(toProfileBasicsIssue)],
    [bridgeIssues, formValidation.issues]
  );
  const issuesByField = React.useMemo(() => mapBasicsIssuesByField(issues), [issues]);
  const authProfileAvailable = authProfiles.some(
    (authProfile) => authProfile.id === draft.authProfileId
  );
  const selectedAuthValue = authProfileAvailable ? draft.authProfileId : "";
  const hasStaleAuth = Boolean(draft.authProfileId) && !authProfileAvailable;
  const currentSerialized = serializeBasicsForm(draft, envRows);
  const isDirty = open && currentSerialized !== baselineSerialized;
  const hasBlockingIssues = issues.length > 0 || previewStatus === "error";
  const saveDisabledReason = getProfileBasicsSaveDisabledReason({
    targetStatus: target.status,
    hasBlockingIssues,
    isSaving,
    previewStatus,
  });
  const saveDisabled = Boolean(saveDisabledReason);
  const canSaveBasics = isDirty && !saveDisabled;

  React.useEffect(() => {
    if (!open) return;

    const safeIssues = formValidation.issues.map(toValidationIssue);
    onValidationStateChange({ status: "ready", issues: safeIssues, errorMessage: null });

    if (target.status !== "writable" || !formValidation.ok) {
      setBridgeIssues([]);
      setPreviewStatus("idle");
      setPreviewError(null);
      setPreviewItems([]);
      onPreviewStateChange({ status: "idle", effective: null, diff: [], errorMessage: null });
      return;
    }

    const patch = buildProfileBasicsPatch({
      target,
      draft: formValidation.draft,
      authProfiles,
    });
    if (!patch.ok) {
      setBridgeIssues([]);
      setPreviewStatus("idle");
      setPreviewError(null);
      setPreviewItems([]);
      onValidationStateChange({
        status: "ready",
        issues: patch.issues.map(toValidationIssue),
        errorMessage: null,
      });
      onPreviewStateChange({ status: "idle", effective: null, diff: [], errorMessage: null });
      return;
    }

    const profileApi = window.myclaude?.profile;
    if (!profileApi?.validate || !profileApi.preview) {
      const message = "Profile Basics preview is unavailable right now.";
      setPreviewStatus("error");
      setPreviewError(message);
      setBridgeIssues([]);
      setPreviewItems(createSafeProfileBasicsPreviewSummary(target.content, patch.content));
      onPreviewStateChange({ status: "error", effective: null, diff: [], errorMessage: message });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewStatus("loading");
      setPreviewError(null);
      onPreviewStateChange({
        status: "loading",
        effective: null,
        diff: [],
        errorMessage: null,
      });

      void Promise.all([
        profileApi.validate({ content: patch.content }),
        profileApi.preview({
          role: patch.selection.role,
          authProfileId: patch.selection.authProfileId,
          cwd: patch.selection.cwd,
          draft: { path: patch.path, content: patch.content },
        }),
      ])
        .then(([validationResult, previewResult]) => {
          if (cancelled) return;
          const validationIssues = sanitizeValidationIssues(
            normalizeValidationIssues(validationResult)
          );
          const preview = normalizeProfilePreviewResponse(previewResult, {
            currentEffective,
            createDiffSummary: createSafeEffectiveDiffSummary,
          });
          const previewIssues = sanitizeValidationIssues(preview.issues);
          const mergedIssues = mergeValidationIssues(validationIssues, previewIssues);
          const summary = createSafeProfileBasicsPreviewSummary(target.content, patch.content);
          setBridgeIssues(mergedIssues);
          setPreviewItems(summary);
          onValidationStateChange({ status: "ready", issues: mergedIssues, errorMessage: null });

          if (preview.status === "error") {
            const message =
              "Profile Basics preview could not be prepared. Review the fields and try again.";
            setPreviewStatus("error");
            setPreviewError(message);
            onPreviewStateChange({
              status: "error",
              effective: null,
              diff: [],
              errorMessage: message,
            });
            announce("Profile Basics preview needs attention");
            return;
          }

          setPreviewStatus("ready");
          setPreviewError(null);
          onPreviewStateChange({
            status: "ready",
            effective: preview.effective,
            diff: createSafeEffectiveDiffSummary(currentEffective, preview.effective),
            errorMessage: null,
          });
          announce(
            summary.length > 0
              ? "Profile Basics preview ready"
              : "Profile Basics preview has no changes"
          );
        })
        .catch((error) => {
          if (cancelled) return;
          const message = formatProfileBasicsBridgeError(
            error,
            "Profile Basics preview could not be prepared. Review the fields and try again."
          );
          setBridgeIssues([]);
          setPreviewStatus("error");
          setPreviewError(message);
          setPreviewItems(createSafeProfileBasicsPreviewSummary(target.content, patch.content));
          onValidationStateChange({ status: "error", issues: [], errorMessage: message });
          onPreviewStateChange({
            status: "error",
            effective: null,
            diff: [],
            errorMessage: message,
          });
          announce("Profile Basics preview failed");
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    announce,
    authProfiles,
    currentEffective,
    formValidation,
    onPreviewStateChange,
    onValidationStateChange,
    open,
    target,
  ]);

  const completeClose = React.useCallback(() => {
    pendingLeaveContinuationRef.current = null;
    setDirtyPromptOpen(false);
    setSaveError(null);
    setPickerError(null);
    setBridgeIssues([]);
    setPreviewStatus("idle");
    setPreviewError(null);
    setPreviewItems([]);
    onValidationStateChange({ status: "idle", issues: [], errorMessage: null });
    onPreviewStateChange({ status: "idle", effective: null, diff: [], errorMessage: null });
    onOpenChange(false);
    announce("Guided Profile Basics closed");
  }, [announce, onOpenChange, onPreviewStateChange, onValidationStateChange]);

  const completeCloseAndContinue = React.useCallback(
    (continuation: (() => void) | null) => {
      completeClose();
      window.setTimeout(() => {
        continuation?.();
      }, 0);
    },
    [completeClose]
  );

  const requestLeave = React.useCallback(
    (continuation: (() => void) | null = null) => {
      if (shouldGuardProfileBasicsClose({ isDirty, isSaving })) {
        pendingLeaveContinuationRef.current = continuation;
        setDirtyPromptOpen(true);
        announce("Profile Basics has unsaved changes");
        return;
      }
      completeCloseAndContinue(continuation);
    },
    [announce, completeCloseAndContinue, isDirty, isSaving]
  );

  const requestClose = React.useCallback(() => {
    requestLeave(null);
  }, [requestLeave]);

  const handleOpenAdvanced = React.useCallback(() => {
    requestLeave(onOpenAdvanced);
  }, [onOpenAdvanced, requestLeave]);

  const handleOpenClaudeAuth = React.useCallback(() => {
    requestLeave(onOpenClaudeAuth);
  }, [onOpenClaudeAuth, requestLeave]);

  const updateDraft = React.useCallback((patch: Partial<ProfileBasicsDraft>) => {
    setSaveError(null);
    setBridgeIssues([]);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const handlePickWorkspace = React.useCallback(async () => {
    const picker = window.myclaude?.system?.pickDirectory;
    if (!picker) {
      setPickerError("Workspace picker is unavailable. The typed workspace is preserved.");
      return;
    }

    try {
      const picked = await picker();
      if (picked) {
        updateDraft({ cwd: picked });
        setPickerError(null);
      }
    } catch {
      setPickerError("Workspace picker could not open. The typed workspace is preserved.");
    }
  }, [updateDraft]);

  const saveBasicsDraft = React.useCallback(async (): Promise<BasicsSaveResult> => {
    if (target.status !== "writable") {
      const message = target.message;
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }
    if (!formValidation.ok || issues.length > 0) {
      const message = "Fix the highlighted Basics fields before saving.";
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }

    const patch = buildProfileBasicsPatch({
      target,
      draft: formValidation.draft,
      authProfiles,
    });
    if (!patch.ok) {
      const message = "Fix the highlighted Basics fields before saving.";
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }

    const profileApi = window.myclaude?.profile;
    if (!profileApi?.save) {
      const message = "Profile Basics save is unavailable right now.";
      setSaveError(message);
      announce(message);
      return { ok: false, message };
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await profileApi.save({ path: patch.path, content: patch.content });
      await onSaved(patch.selection);
      setBaselineSerialized(serializeBasicsForm(formValidation.draft, envRows));
      announce("Guided Profile Basics saved");
      return { ok: true };
    } catch (error) {
      const message = formatProfileBasicsBridgeError(
        error,
        "Profile Basics could not be saved. Review the fields and try again."
      );
      setSaveError(message);
      announce(`Profile Basics save failed: ${message}`);
      return { ok: false, message };
    } finally {
      setIsSaving(false);
    }
  }, [announce, authProfiles, envRows, formValidation, issues.length, onSaved, target]);

  const saveBasicsAndClose = React.useCallback(async (): Promise<void> => {
    const result = await saveBasicsDraft();
    if (!result.ok) {
      throw new Error(result.message);
    }
    completeClose();
  }, [completeClose, saveBasicsDraft]);

  const handleSave = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const result = await saveBasicsDraft();
      if (result.ok) {
        completeClose();
      }
    },
    [completeClose, saveBasicsDraft]
  );

  const discardBasicsAndClose = React.useCallback(() => {
    completeClose();
  }, [completeClose]);

  React.useEffect(() => {
    if (!open) {
      setBasicsNavigationGuard(null);
      return;
    }
    setBasicsNavigationGuard({
      isDirty,
      isSaving,
      canSave: canSaveBasics,
      saveDisabledReason,
      saveAndClose: saveBasicsAndClose,
      discardAndClose: discardBasicsAndClose,
    });
  }, [
    canSaveBasics,
    discardBasicsAndClose,
    isDirty,
    isSaving,
    open,
    saveBasicsAndClose,
    saveDisabledReason,
    setBasicsNavigationGuard,
  ]);

  React.useEffect(
    () => () => {
      setBasicsNavigationGuard(null);
    },
    [setBasicsNavigationGuard]
  );

  const cancelDirtyPrompt = React.useCallback(() => {
    setDirtyPromptOpen(false);
    announce("Stayed in guided Profile Basics.");
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
  }, [announce]);

  const discardDirtyPromptAndContinue = React.useCallback(() => {
    const continuation = pendingLeaveContinuationRef.current;
    announce("Discarded Profile Basics changes.");
    completeCloseAndContinue(continuation);
  }, [announce, completeCloseAndContinue]);

  const saveDirtyPromptAndContinue = React.useCallback(async () => {
    const continuation = pendingLeaveContinuationRef.current;
    const result = await saveBasicsDraft();
    if (!result.ok) return;
    completeCloseAndContinue(continuation);
  }, [completeCloseAndContinue, saveBasicsDraft]);

  const addEnvRow = React.useCallback(() => {
    setEnvRows((current) => [...current, { id: crypto.randomUUID(), key: "", value: "" }]);
  }, []);

  const updateEnvRow = React.useCallback(
    (rowId: string, patch: Partial<Pick<ProfileBasicsEnvRow, "key" | "value">>) => {
      setSaveError(null);
      setBridgeIssues([]);
      setEnvRows((current) =>
        current.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
      );
    },
    []
  );

  const removeEnvRow = React.useCallback((rowId: string) => {
    setSaveError(null);
    setBridgeIssues([]);
    setEnvRows((current) => current.filter((row) => row.id !== rowId));
  }, []);

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
      ? "Guided Basics will update the selected Agent Profile without exposing raw Layers."
      : target.message;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-5xl overflow-hidden p-0"
        data-testid="profile-basics-panel"
      >
        <form className="flex max-h-[90vh] min-h-0 flex-col" onSubmit={handleSave}>
          <DialogHeader className="border-b border-subtle bg-surface/95 px-6 py-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <IconFrame icon={Sparkles} size="sm" tone="accent" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
                    Guided Basics
                  </p>
                  <DialogTitle className="mt-1 text-xl tracking-[-0.02em] text-primary">
                    Customize {profile.name}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-sm leading-6 text-secondary">
                    Edit profile-owned name, purpose, Claude identity, workspace, environment, and
                    settings without opening raw Layers by default.
                  </DialogDescription>
                </div>
              </div>
              <Button
                aria-label="Close Profile Basics"
                className="min-h-10 min-w-10 shrink-0"
                onClick={requestClose}
                type="button"
                variant="ghost"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </DialogHeader>

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
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      data-testid="profile-basics-open-advanced"
                      onClick={handleOpenAdvanced}
                      type="button"
                      variant="secondary"
                    >
                      Open Profile Workspace
                    </Button>
                  </div>
                ) : null}
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field
                  description="Use a short product name for the selected Agent Profile."
                  htmlFor="profile-basics-display-name"
                  label="Display name"
                  {...fieldErrorProps(issuesByField.displayName)}
                >
                  <Input
                    aria-invalid={issuesByField.displayName ? true : undefined}
                    data-testid="profile-basics-display-name"
                    disabled={target.status !== "writable" || isSaving}
                    id="profile-basics-display-name"
                    onChange={(event) => updateDraft({ displayName: event.currentTarget.value })}
                    ref={initialFocusRef}
                    value={draft.displayName}
                  />
                </Field>

                <Field
                  description="Explain the job this profile should help with."
                  htmlFor="profile-basics-purpose"
                  label="Purpose"
                  {...fieldErrorProps(issuesByField.purpose)}
                >
                  <Input
                    aria-invalid={issuesByField.purpose ? true : undefined}
                    data-testid="profile-basics-purpose"
                    disabled={target.status !== "writable" || isSaving}
                    id="profile-basics-purpose"
                    onChange={(event) => updateDraft({ purpose: event.currentTarget.value })}
                    value={draft.purpose}
                  />
                </Field>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Field
                  description="Claude Auth owns credentials; Basics only chooses which identity this profile uses."
                  label="Claude identity"
                  {...fieldErrorProps(issuesByField.authProfileId)}
                >
                  {authProfiles.length > 0 ? (
                    <div className="grid gap-2">
                      <Select
                        aria-label="Claude identity"
                        className="min-h-10"
                        disabled={target.status !== "writable" || isSaving}
                        onValueChange={(value) => updateDraft({ authProfileId: value })}
                        options={authProfiles.map((authProfile) => ({
                          value: authProfile.id,
                          label: formatAuthOptionLabel(authProfile),
                        }))}
                        placeholder="Choose a Claude identity"
                        value={selectedAuthValue}
                      />
                      {hasStaleAuth ? (
                        <p className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-xs font-medium text-status-warning">
                          The previously selected Claude identity is unavailable. Choose an
                          available identity before saving.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid gap-3 rounded-md border border-status-warning bg-status-warning-soft px-3 py-3 text-sm text-status-warning">
                      <p>No Claude identities are available. Add one before saving Basics.</p>
                      <Button onClick={handleOpenClaudeAuth} type="button" variant="secondary">
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                        Manage Claude Auth
                      </Button>
                    </div>
                  )}
                </Field>

                <Field
                  description="The profile launches Claude from this workspace."
                  htmlFor="profile-basics-workspace"
                  label="Workspace"
                  {...fieldErrorProps(issuesByField.cwd ?? pickerError)}
                >
                  <div className="flex gap-2">
                    <Input
                      aria-invalid={issuesByField.cwd || pickerError ? true : undefined}
                      className="font-mono text-xs"
                      data-testid="profile-basics-workspace"
                      disabled={target.status !== "writable" || isSaving}
                      id="profile-basics-workspace"
                      onChange={(event) => updateDraft({ cwd: event.currentTarget.value })}
                      value={draft.cwd}
                    />
                    <Button
                      className="min-h-10 shrink-0"
                      disabled={target.status !== "writable" || isSaving}
                      onClick={() => void handlePickWorkspace()}
                      type="button"
                      variant="secondary"
                    >
                      <FolderOpen className="h-4 w-4" aria-hidden="true" />
                      Choose…
                    </Button>
                  </div>
                </Field>
              </div>

              <section className="rounded-xl border border-default bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">Environment variables</h3>
                    <p className="mt-1 text-sm leading-6 text-secondary">
                      Values stay in this guided editor; summaries only report safe keys and counts.
                    </p>
                  </div>
                  <Button
                    disabled={target.status !== "writable" || isSaving}
                    onClick={addEnvRow}
                    type="button"
                    variant="secondary"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add variable
                  </Button>
                </div>
                {issuesByField.env ? (
                  <p className="mt-3 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
                    {issuesByField.env}
                  </p>
                ) : null}
                {envRows.length > 0 ? (
                  <div className="mt-4 grid gap-3" data-testid="profile-basics-env-rows">
                    {envRows.map((row, index) => (
                      <div
                        className="grid gap-2 sm:grid-cols-[minmax(0,0.65fr)_minmax(0,1fr)_auto]"
                        key={row.id}
                      >
                        <Input
                          aria-label={`Environment variable ${index + 1} name`}
                          disabled={target.status !== "writable" || isSaving}
                          onChange={(event) =>
                            updateEnvRow(row.id, { key: event.currentTarget.value })
                          }
                          placeholder="FEATURE_FLAG"
                          value={row.key}
                        />
                        <Input
                          aria-label={`Environment variable ${index + 1} value`}
                          disabled={target.status !== "writable" || isSaving}
                          onChange={(event) =>
                            updateEnvRow(row.id, { value: event.currentTarget.value })
                          }
                          placeholder="enabled"
                          value={row.value}
                        />
                        <Button
                          aria-label={`Remove environment variable ${index + 1}`}
                          className="min-h-10 min-w-10"
                          disabled={target.status !== "writable" || isSaving}
                          onClick={() => removeEnvRow(row.id)}
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed border-subtle bg-canvas/60 px-4 py-5 text-sm text-secondary">
                    No environment variables in guided Basics yet.
                  </p>
                )}
              </section>

              <Field
                className="rounded-xl border border-default bg-surface p-4"
                description="Enter a JSON object. Secret-like values are blocked and should stay in Claude Auth."
                htmlFor="profile-basics-settings"
                label="Advanced settings"
                {...fieldErrorProps(issuesByField.settings)}
              >
                <textarea
                  aria-invalid={issuesByField.settings ? true : undefined}
                  className="min-h-48 rounded-md border border-default bg-canvas px-3 py-2 font-mono text-sm text-primary shadow-xs focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="profile-basics-settings"
                  disabled={target.status !== "writable" || isSaving}
                  id="profile-basics-settings"
                  onChange={(event) => updateDraft({ settingsJson: event.currentTarget.value })}
                  value={draft.settingsJson}
                />
              </Field>
            </div>

            <aside className="border-t border-subtle bg-canvas/65 px-6 py-5 lg:border-l lg:border-t-0">
              <section
                aria-live="polite"
                className="sticky top-0 grid gap-4"
                data-testid="profile-basics-preview"
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
                          ? "Checking the guided Basics draft…"
                          : previewStatus === "error"
                            ? previewError
                            : issues.length > 0
                              ? "Fix validation issues to preview safely."
                              : previewItems.length > 0
                                ? `${previewItems.length} safe Basics change${previewItems.length === 1 ? "" : "s"} ready to review.`
                                : "No Basics changes yet."}
                      </p>
                    </div>
                  </div>

                  {previewItems.length > 0 && previewStatus !== "error" ? (
                    <ul className="mt-4 grid gap-2">
                      {previewItems.slice(0, 12).map((item, index) => (
                        <li
                          className="rounded-md border border-subtle bg-canvas/70 px-3 py-2 text-sm text-secondary"
                          key={`${item.section}:${item.key}:${item.change}:${index}`}
                        >
                          <span className="font-medium text-primary">
                            {formatPreviewChange(item.change)}
                          </span>{" "}
                          {formatPreviewSection(item.section)} · {item.key}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="rounded-xl border border-default bg-surface p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Settings2 className="h-4 w-4 text-secondary" aria-hidden="true" />
                    Save readiness
                  </h3>
                  <ul className="mt-3 grid gap-2 text-sm text-secondary">
                    <ReadinessLine ok={target.status === "writable"}>
                      Writable profile target
                    </ReadinessLine>
                    <ReadinessLine ok={authProfiles.length > 0 && !hasStaleAuth}>
                      Available Claude identity
                    </ReadinessLine>
                    <ReadinessLine ok={!issuesByField.settings}>Valid settings JSON</ReadinessLine>
                    <ReadinessLine ok={!issuesByField.env}>Unique, safe env rows</ReadinessLine>
                  </ul>
                </div>

                {issues.length > 0 || saveError || target.status !== "writable" ? (
                  <div
                    className="rounded-xl border border-status-danger bg-status-danger-soft p-4 text-sm text-status-danger"
                    data-testid="profile-basics-error"
                    role="alert"
                  >
                    <p className="font-semibold">Basics needs attention</p>
                    <ul className="mt-2 grid gap-1">
                      {target.status !== "writable" ? <li>{target.message}</li> : null}
                      {issues.slice(0, 4).map((issue, index) => (
                        <li key={`${issue.path}:${index}`}>{issue.message}</li>
                      ))}
                      {saveError ? <li>{saveError}</li> : null}
                    </ul>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>

          <DialogFooter className="flex-wrap border-t border-subtle bg-surface/95 px-6 py-4">
            <Button
              data-testid="profile-basics-cancel"
              disabled={isSaving}
              onClick={requestClose}
              ref={cancelButtonRef}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              data-testid="profile-basics-save"
              disabled={saveDisabled}
              type="submit"
              variant="primary"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSaving ? "Saving…" : "Save Basics"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <Dialog
        open={dirtyPromptOpen}
        onOpenChange={(nextOpen) => (nextOpen ? undefined : cancelDirtyPrompt())}
      >
        <DialogContent className="max-w-md" data-testid="profile-basics-dirty-dialog">
          <DialogHeader>
            <DialogTitle>Save Profile Basics changes?</DialogTitle>
            <DialogDescription>
              You have unsaved guided Basics edits. Save before leaving, discard the draft, or stay
              here to keep editing.
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter className="flex-wrap">
            <Button
              data-testid="profile-basics-dirty-cancel"
              disabled={isSaving}
              onClick={cancelDirtyPrompt}
              type="button"
              variant="ghost"
            >
              Keep editing
            </Button>
            <Button
              data-testid="profile-basics-dirty-discard"
              disabled={isSaving}
              onClick={discardDirtyPromptAndContinue}
              type="button"
              variant="secondary"
            >
              Discard changes
            </Button>
            <Button
              data-testid="profile-basics-dirty-save"
              disabled={!canSaveBasics || isSaving}
              onClick={() => void saveDirtyPromptAndContinue()}
              type="button"
              variant="primary"
            >
              {isSaving ? "Saving…" : "Save Basics"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function createPanelDraft(
  scopeEntries: readonly ScopeListEntry[],
  selectedRole: string,
  profile: AgentProfileViewModel,
  selectedAuthId: string,
  cwd: string
): ProfileBasicsDraft {
  return createProfileBasicsDraft(resolveProfileBasicsTarget({ scopeEntries, selectedRole }), {
    role: selectedRole,
    authProfileId: selectedAuthId,
    cwd,
    displayName: profile.name,
    purpose: profile.purposeLabel,
  });
}

function serializeBasicsForm(
  draft: ProfileBasicsDraft,
  envRows: readonly ProfileBasicsEnvRow[]
): string {
  return stableStringify({
    displayName: draft.displayName,
    purpose: draft.purpose,
    authProfileId: draft.authProfileId,
    cwd: draft.cwd,
    settingsJson: draft.settingsJson,
    envRows: envRows.map((row) => ({ key: row.key, value: row.value })),
  });
}

function getProfileBasicsSaveDisabledReason({
  hasBlockingIssues,
  isSaving,
  previewStatus,
  targetStatus,
}: {
  targetStatus: ProfileBasicsTarget["status"];
  hasBlockingIssues: boolean;
  isSaving: boolean;
  previewStatus: BasicsAsyncStatus;
}): string | null {
  if (targetStatus !== "writable") return "Profile Basics needs a writable profile target.";
  if (hasBlockingIssues) return "Fix the highlighted Basics fields before saving.";
  if (previewStatus === "loading") return "Wait for Profile Basics preview to finish checking.";
  if (isSaving) return "Profile Basics is saving.";
  return null;
}

function fieldErrorProps(
  error: string | null | undefined
): { error: string } | Record<string, never> {
  return error ? { error } : {};
}

function mapBasicsIssuesByField(
  issues: readonly { field: string; message: string }[]
): Partial<
  Record<"displayName" | "purpose" | "authProfileId" | "cwd" | "env" | "settings", string>
> {
  const byField: Partial<
    Record<"displayName" | "purpose" | "authProfileId" | "cwd" | "env" | "settings", string>
  > = {};
  for (const issue of issues) {
    if (
      issue.field === "displayName" ||
      issue.field === "purpose" ||
      issue.field === "authProfileId" ||
      issue.field === "cwd" ||
      issue.field === "env" ||
      issue.field === "settings"
    ) {
      byField[issue.field] ??= issue.message;
    }
  }
  return byField;
}

function toProfileBasicsIssue(issue: ValidationIssue): {
  field: "target";
  path: string;
  message: string;
  severity: "error";
} {
  return {
    field: "target",
    path: issue.path,
    message: issue.message,
    severity: "error",
  };
}

function toValidationIssue(issue: {
  path: string;
  message: string;
  severity: string;
}): ValidationIssue {
  return {
    path: issue.path,
    message: issue.message,
    severity: issue.severity,
  };
}

function sanitizeValidationIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue, index) => ({
    path: safeIssuePath(issue.path, index),
    severity: issue.severity || "error",
    message: safeValidationMessage(issue),
  }));
}

function safeIssuePath(path: string, index: number): string {
  if (/keyring:\/\/|\$\{secret:|secretRef|bearer\s+|token/i.test(path)) {
    return `profile-basics.${index + 1}`;
  }
  return path || `profile-basics.${index + 1}`;
}

function safeValidationMessage(issue: ValidationIssue): string {
  if (/auth|identity/i.test(issue.path)) {
    return "Choose an available Claude identity before saving basics.";
  }
  if (/settings|json/i.test(issue.path)) {
    return "Settings must be valid JSON and safe to save.";
  }
  if (/env/i.test(issue.path)) {
    return "Environment variables need safe names and non-secret values.";
  }
  return "Profile Basics needs a safe value before saving.";
}

function createSafeEffectiveDiffSummary(
  current: EffectiveConfig | null,
  preview: EffectiveConfig | null
): DiffItem[] {
  if (!current || !preview) return [];
  const items: DiffItem[] = [];
  for (const key of safeSortedUnion(Object.keys(current.env), Object.keys(preview.env))) {
    if (current.env[key] === preview.env[key]) continue;
    items.push({
      section: "env",
      key: safeDiffKey(key, "environment variable"),
      change:
        current.env[key] === undefined
          ? "added"
          : preview.env[key] === undefined
            ? "removed"
            : "changed",
    });
  }
  for (const key of safeSortedUnion(Object.keys(current.settings), Object.keys(preview.settings))) {
    if (stableStringify(current.settings[key]) === stableStringify(preview.settings[key])) continue;
    items.push({
      section: "settings",
      key: safeDiffKey(key, "advanced setting"),
      change:
        current.settings[key] === undefined
          ? "added"
          : preview.settings[key] === undefined
            ? "removed"
            : "changed",
    });
  }
  return items;
}

function safeSortedUnion(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).sort((a, b) => a.localeCompare(b));
}

function safeDiffKey(value: string, fallback: string): string {
  if (/secret|token|authorization|api[_-]?key|keyring|bearer/i.test(value)) return fallback;
  return value || fallback;
}

function formatAuthOptionLabel(authProfile: AuthProfileOption): string {
  const label = sanitizeProfileLabel(authProfile.displayName) ?? "Claude identity";
  return `${label} · ${formatAuthMode(authProfile.mode)} · ${formatSecretCount(authProfile.secretCount)}`;
}

function formatAuthMode(mode: string): string {
  if (/^api[-_]?key$/i.test(mode)) return "API key";
  if (/^oauth$/i.test(mode)) return "OAuth";
  return mode || "Unknown";
}

function formatSecretCount(count: number): string {
  if (count <= 0) return "No stored secrets";
  if (count === 1) return "1 stored secret";
  return `${count} stored secrets`;
}

function formatPreviewStatus(status: BasicsAsyncStatus): string {
  if (status === "loading") return "Checking";
  if (status === "ready") return "Ready";
  if (status === "error") return "Needs attention";
  return "Waiting";
}

function formatPreviewChange(change: ProfileBasicsPreviewSummaryItem["change"]): string {
  if (change === "added") return "Adds";
  if (change === "removed") return "Removes";
  return "Changes";
}

function formatPreviewSection(section: ProfileBasicsPreviewSummaryItem["section"]): string {
  if (section === "profile") return "Profile";
  if (section === "identity") return "Claude identity";
  if (section === "environment") return "Environment";
  return "Settings";
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
      <span className={cn(ok ? "text-secondary" : "text-status-warning")}>{children}</span>
    </li>
  );
}

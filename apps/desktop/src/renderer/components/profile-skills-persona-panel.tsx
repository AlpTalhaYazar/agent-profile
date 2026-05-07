import { Button, Field, Input } from "@agent-profile/ui";
import { useSetAtom } from "jotai";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Eye,
  FileText,
  ListChecks,
  type LucideIcon,
  PackagePlus,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import type { SkillCatalogItem } from "../../shared/bridge.js";
import type { AgentProfileViewModel } from "../lib/agent-profile-view-model.js";
import { profileSkillsPersonaNavigationGuardAtom } from "../lib/atoms.js";
import { stableStringify } from "../lib/clone.js";
import { normalizeValidationIssues } from "../lib/normalize.js";
import {
  createCatalogInstallAttachment,
  createInstalledSkillAttachment,
  isDuplicateSkillAttachment,
  normalizeAgentProfileSkillItems,
  safeSkillDescription,
  safeSkillName,
  safeVisibleSegment,
  sanitizeSkillBridgeError,
  type SafeProfileSkillAttachment,
} from "../lib/skills-catalog.js";
import {
  PROFILE_SKILLS_PERSONA_CATEGORIES,
  type ProfileSkillsPersonaCategory,
  type ProfileSkillsPersonaDraft,
  type ProfileSkillsPersonaDraftRow,
  type ProfileSkillsPersonaPreviewSummaryItem,
  type ProfileSkillsPersonaTarget,
  type ProfileSkillsPersonaValidationIssue,
  buildProfileSkillsPersonaPatch,
  createDefaultProfileSkillsPersonaDraftRow,
  createProfileSkillsPersonaDraft,
  createSafeProfileSkillsPersonaPreviewSummary,
  formatProfileSkillsPersonaBridgeError,
  isProfileSkillsPersonaOpaqueSkillRef,
  resolveProfileSkillsPersonaTarget,
  resolveProfileSkillsPersonaTargetFromList,
  shouldGuardProfileSkillsPersonaClose,
  validateProfileSkillsPersonaForm,
} from "../lib/profile-skills-persona.js";
import type {
  DiffItem,
  PreviewState,
  ScopeListEntry,
  ValidationIssue,
  ValidationState,
} from "../lib/types.js";
import { useAnnounce } from "./live-announcer.js";
import { IconFrame, StatusChip } from "./screen-ui.js";

interface ProfileSkillsPersonaPanelProps {
  cwd: string;
  onOpenAdvanced: () => void;
  onOpenChange: (open: boolean) => void;
  onPreviewStateChange: (state: PreviewState) => void;
  onSaved: (selection: {
    role: string;
    authProfileId: string;
    cwd: string;
  }) => Promise<void>;
  onValidationStateChange: (state: ValidationState) => void;
  open: boolean;
  profile: AgentProfileViewModel;
  scopeEntries: readonly ScopeListEntry[];
  selectedAuthId: string;
  selectedRole: string;
  selectedScopePath: string | null;
}

type SkillsPersonaAsyncStatus =
  | "idle"
  | "pending"
  | "loading"
  | "ready"
  | "error";
type SkillsPersonaSaveResult = { ok: true } | { ok: false; message: string };
type ProfileBridge = NonNullable<typeof window.myclaude>["profile"];

interface PersonaPreviewCategoryCount {
  category: ProfileSkillsPersonaCategory;
  count: number;
}

interface PersonaPreviewBasename {
  category: ProfileSkillsPersonaCategory;
  basename: string;
}

interface PersonaPreviewMissingSourceWarning {
  category: ProfileSkillsPersonaCategory;
  basename: string;
  count: number;
}

interface PersonaPreviewCollisionWarning {
  category: Exclude<ProfileSkillsPersonaCategory, "claudeMd">;
  basename: string;
  hiddenCount: number;
}

interface PersonaPreviewMetrics {
  claudeMdSectionCount: number;
  claudeMdCharacterCount: number;
  fileCount: number;
  fileCharacterCount: number;
  totalCharacterCount: number;
  truncatedItemCount: number;
}

interface PersonaPreviewPayload {
  categoryCounts: PersonaPreviewCategoryCount[];
  basenames: PersonaPreviewBasename[];
  missingSources: PersonaPreviewMissingSourceWarning[];
  collisions: PersonaPreviewCollisionWarning[];
  metrics: PersonaPreviewMetrics;
}

type PersonaPreviewAdapterResult =
  | {
      status: "ready";
      issues: ValidationIssue[];
      preview: PersonaPreviewPayload | null;
      errorMessage: null;
    }
  | {
      status: "error";
      issues: ValidationIssue[];
      preview: PersonaPreviewPayload | null;
      errorMessage: string;
    };

const CATEGORY_CONFIG: Record<
  ProfileSkillsPersonaCategory,
  {
    addLabel: string;
    description: string;
    empty: string;
    icon: LucideIcon;
    label: string;
    noun: string;
    placeholder: string;
  }
> = {
  claudeMd: {
    addLabel: "Add instructions",
    description:
      "Attach Claude instruction fragments that shape the profile voice.",
    empty: "No Claude instructions attached yet.",
    icon: FileText,
    label: "Claude instructions",
    noun: "instruction file",
    placeholder: "CLAUDE.md",
  },
  agents: {
    addLabel: "Add agent",
    description: "Attach reusable agent definitions for this profile.",
    empty: "No agents attached yet.",
    icon: Bot,
    label: "Agents",
    noun: "agent",
    placeholder: "agents/reviewer.md",
  },
  skills: {
    addLabel: "Add skill",
    description:
      "Attach installed or catalog-backed skills without exposing raw Layers.",
    empty: "No skills attached yet.",
    icon: Sparkles,
    label: "Skills",
    noun: "skill",
    placeholder: "skills/react/SKILL.md",
  },
  slashCmds: {
    addLabel: "Add slash command",
    description: "Attach slash commands that should travel with this profile.",
    empty: "No slash commands attached yet.",
    icon: Settings2,
    label: "Slash commands",
    noun: "slash command",
    placeholder: "commands/review.md",
  },
  memory: {
    addLabel: "Add memory",
    description: "Attach reusable memory notes for this profile.",
    empty: "No memory attached yet.",
    icon: Brain,
    label: "Memory",
    noun: "memory file",
    placeholder: "memory/project.md",
  },
};

const UNSAFE_VISIBLE_TEXT_RE =
  /\.myclaude|project-role|global-role|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|oauth|authorization|\/Users\/|\/tmp\/|\b[A-Za-z]:\\|\bnpx\b/i;

export function ProfileSkillsPersonaPanel({
  cwd,
  onOpenAdvanced,
  onOpenChange,
  onPreviewStateChange,
  onSaved,
  onValidationStateChange,
  open,
  profile,
  scopeEntries,
  selectedAuthId,
  selectedRole,
  selectedScopePath,
}: ProfileSkillsPersonaPanelProps): React.ReactElement | null {
  const announce = useAnnounce();
  const setSkillsPersonaNavigationGuard = useSetAtom(
    profileSkillsPersonaNavigationGuardAtom,
  );
  const initialFocusRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const dirtyCancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const pendingLeaveContinuationRef = React.useRef<(() => void) | null>(null);
  const target = React.useMemo(
    () =>
      resolveProfileSkillsPersonaTarget({
        scopeEntries,
        selectedRole,
        selectedScopePath,
      }),
    [scopeEntries, selectedRole, selectedScopePath],
  );
  const [draft, setDraft] = React.useState<ProfileSkillsPersonaDraft>(() =>
    createProfileSkillsPersonaDraft(target),
  );
  const [baselineSerialized, setBaselineSerialized] = React.useState(() =>
    serializeDraft(draft),
  );
  const [bridgeIssues, setBridgeIssues] = React.useState<ValidationIssue[]>([]);
  const [previewStatus, setPreviewStatus] =
    React.useState<SkillsPersonaAsyncStatus>("idle");
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewItems, setPreviewItems] = React.useState<
    ProfileSkillsPersonaPreviewSummaryItem[]
  >([]);
  const [personaPreview, setPersonaPreview] =
    React.useState<PersonaPreviewPayload | null>(null);
  const [previewedSerialized, setPreviewedSerialized] = React.useState<
    string | null
  >(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [dirtyPromptOpen, setDirtyPromptOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [installedSkills, setInstalledSkills] = React.useState<
    SkillCatalogItem[]
  >([]);
  const [installedStatus, setInstalledStatus] =
    React.useState<SkillsPersonaAsyncStatus>("idle");
  const [skillQuery, setSkillQuery] = React.useState("");
  const [skillResults, setSkillResults] = React.useState<SkillCatalogItem[]>(
    [],
  );
  const [skillSearchStatus, setSkillSearchStatus] =
    React.useState<SkillsPersonaAsyncStatus>("idle");
  const [skillCatalogError, setSkillCatalogError] = React.useState<
    string | null
  >(null);
  const [installingSkillId, setInstallingSkillId] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (!open) return;
    const nextDraft = createProfileSkillsPersonaDraft(target);
    setDraft(nextDraft);
    setBaselineSerialized(serializeDraft(nextDraft));
    setBridgeIssues([]);
    setPreviewStatus("idle");
    setPreviewError(null);
    setPreviewItems([]);
    setPersonaPreview(null);
    setPreviewedSerialized(null);
    setSaveError(null);
    setDirtyPromptOpen(false);
    setInstalledSkills([]);
    setInstalledStatus("idle");
    setSkillQuery("");
    setSkillResults([]);
    setSkillSearchStatus("idle");
    setSkillCatalogError(null);
    setInstallingSkillId(null);
    announce("Guided Skills & Persona opened");
    const frameId = window.requestAnimationFrame(() =>
      initialFocusRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frameId);
  }, [announce, open, target]);

  const formValidation = React.useMemo(
    () => validateProfileSkillsPersonaForm({ target, draft }),
    [draft, target],
  );
  const issues = React.useMemo(
    () => [
      ...formValidation.issues,
      ...bridgeIssues.map(toProfileSkillsPersonaIssue),
    ],
    [bridgeIssues, formValidation.issues],
  );
  const issuesByField = React.useMemo(() => mapIssuesByField(issues), [issues]);
  const currentSerialized = serializeDraft(draft);
  const isDirty = open && currentSerialized !== baselineSerialized;
  const hasSelection = Boolean(
    selectedRole.trim() && selectedAuthId.trim() && cwd.trim(),
  );
  const hasCurrentPreview =
    previewStatus === "ready" && previewedSerialized === currentSerialized;
  const hasBlockingIssues =
    issues.length > 0 || previewStatus === "error" || !hasSelection;
  const saveDisabledReason = getSaveDisabledReason({
    hasBlockingIssues,
    hasCurrentPreview,
    hasSelection,
    isDirty,
    isSaving,
    previewStatus,
    targetStatus: target.status,
  });
  const saveDisabled = Boolean(saveDisabledReason);
  const canSaveSkillsPersona = isDirty && !saveDisabled;

  React.useEffect(() => {
    if (!open) return;
    onValidationStateChange({
      status: "ready",
      issues: formValidation.issues.map(toValidationIssue),
      errorMessage: null,
    });
    if (!formValidation.ok || target.status !== "writable") {
      onPreviewStateChange({
        status: "idle",
        effective: null,
        diff: [],
        errorMessage: null,
      });
    }
  }, [
    formValidation,
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
    setPersonaPreview(null);
    setPreviewedSerialized(null);
    setSkillCatalogError(null);
    setInstallingSkillId(null);
    onValidationStateChange({ status: "idle", issues: [], errorMessage: null });
    onPreviewStateChange({
      status: "idle",
      effective: null,
      diff: [],
      errorMessage: null,
    });
  }, [onPreviewStateChange, onValidationStateChange]);

  const completeClose = React.useCallback(
    (announceClosed = true) => {
      resetPanelState();
      onOpenChange(false);
      if (announceClosed) announce("Guided Skills & Persona closed");
    },
    [announce, onOpenChange, resetPanelState],
  );

  const completeCloseAndContinue = React.useCallback(
    (continuation: (() => void) | null, announceClosed = true) => {
      completeClose(announceClosed);
      window.setTimeout(() => continuation?.(), 0);
    },
    [completeClose],
  );

  const requestLeave = React.useCallback(
    (continuation: (() => void) | null = null) => {
      if (shouldGuardProfileSkillsPersonaClose({ isDirty, isSaving })) {
        pendingLeaveContinuationRef.current = continuation;
        setDirtyPromptOpen(true);
        announce("Skills & Persona has unsaved changes");
        return;
      }
      completeCloseAndContinue(continuation);
    },
    [announce, completeCloseAndContinue, isDirty, isSaving],
  );

  const updateDraft = React.useCallback(
    (
      updater: (
        current: ProfileSkillsPersonaDraft,
      ) => ProfileSkillsPersonaDraft,
    ) => {
      setSaveError(null);
      setBridgeIssues([]);
      setPreviewedSerialized(null);
      setPreviewStatus("pending");
      setPreviewError(null);
      setPreviewItems([]);
      setPersonaPreview(null);
      setDraft(updater);
    },
    [],
  );

  const addRow = React.useCallback(
    (category: ProfileSkillsPersonaCategory, ref = "") => {
      updateDraft((current) => ({
        rows: [
          ...current.rows,
          createDefaultProfileSkillsPersonaDraftRow({ category, ref }),
        ],
      }));
    },
    [updateDraft],
  );

  const updateRow = React.useCallback(
    (
      rowId: string,
      patch: Partial<Pick<ProfileSkillsPersonaDraftRow, "category" | "ref">>,
    ) => {
      updateDraft((current) => ({
        rows: current.rows.map((row) =>
          row.id === rowId ? { ...row, ...patch } : row,
        ),
      }));
    },
    [updateDraft],
  );

  const removeRow = React.useCallback(
    (rowId: string) => {
      updateDraft((current) => ({
        rows: current.rows.filter((row) => row.id !== rowId),
      }));
    },
    [updateDraft],
  );

  const attachSkill = React.useCallback(
    (
      attachment: SafeProfileSkillAttachment,
      trustedSource: "installed-skill" | "catalog-install",
    ) => {
      const existingSkillRefs = draft.rows
        .filter((row) => row.category === "skills")
        .map((row) => row.ref);
      if (isDuplicateSkillAttachment(existingSkillRefs, attachment.ref)) {
        const message = "That skill is already attached to this profile.";
        setSkillCatalogError(message);
        announce(message);
        return;
      }
      updateDraft((current) => ({
        rows: [
          ...current.rows,
          createDefaultProfileSkillsPersonaDraftRow({
            category: "skills",
            ref: attachment.ref,
            displayLabel: attachment.label,
            trustedSource,
          }),
        ],
      }));
      setSkillCatalogError(null);
      announce(`Attached skill ${attachment.label}`);
    },
    [announce, draft.rows, updateDraft],
  );

  const attachInstalledSkill = React.useCallback(
    (skill: SkillCatalogItem) => {
      const attachment = createInstalledSkillAttachment(skill);
      if (!attachment) {
        const message =
          "That installed skill cannot be attached safely from the guided panel.";
        setSkillCatalogError(message);
        announce(message);
        return;
      }
      attachSkill(attachment, "installed-skill");
    },
    [announce, attachSkill],
  );

  const loadInstalledSkills = React.useCallback(async () => {
    const api = window.myclaude?.skills;
    if (!api?.listInstalled) {
      const message = "Installed skills are unavailable right now.";
      setSkillCatalogError(message);
      announce(message);
      return;
    }
    setInstalledStatus("loading");
    setSkillCatalogError(null);
    try {
      const result = await api.listInstalled({
        scope: "global",
        agent: "claude-code",
      });
      setInstalledSkills(
        normalizeAgentProfileSkillItems(result.skills)
          .filter((skill) => createInstalledSkillAttachment(skill) !== null)
          .slice(0, 100),
      );
      setInstalledStatus("ready");
      announce("Installed skills loaded");
    } catch (error) {
      const message = sanitizeSkillBridgeError(
        error,
        "Installed skills could not be loaded. Try again later.",
      );
      setInstalledStatus("error");
      setSkillCatalogError(message);
      announce(message);
    }
  }, [announce]);

  const searchSkills = React.useCallback(async () => {
    const query = skillQuery.trim();
    if (!query) {
      setSkillCatalogError("Enter a skill name before searching.");
      return;
    }
    const api = window.myclaude?.skills;
    if (!api?.search) {
      const message = "Skill search is unavailable right now.";
      setSkillCatalogError(message);
      announce(message);
      return;
    }
    setSkillSearchStatus("loading");
    setSkillCatalogError(null);
    try {
      const result = await api.search({ query, limit: 10 });
      const safeResults = normalizeAgentProfileSkillItems(result.skills).slice(
        0,
        10,
      );
      setSkillResults(safeResults);
      setSkillSearchStatus("ready");
      announce(
        safeResults.length > 0
          ? "Skill search finished"
          : "Skill search found no matches",
      );
    } catch (error) {
      const message = sanitizeSkillBridgeError(
        error,
        "Skill search failed. Try a different query later.",
      );
      setSkillSearchStatus("error");
      setSkillCatalogError(message);
      announce(message);
    }
  }, [announce, skillQuery]);

  const installSkill = React.useCallback(
    async (skill: SkillCatalogItem) => {
      const api = window.myclaude?.skills;
      if (!api?.install) {
        const message = "Skill install is unavailable right now.";
        setSkillCatalogError(message);
        announce(message);
        return;
      }
      setInstallingSkillId(skill.id);
      setSkillCatalogError(null);
      try {
        const result = await api.install({
          id: skill.id,
          slug: skill.slug,
          source: skill.source,
          ...(skill.installUrl ? { installUrl: skill.installUrl } : {}),
        });
        const attachment = createCatalogInstallAttachment(skill, result);
        if (!attachment) {
          const message =
            "Installed skill response could not be attached safely.";
          setSkillCatalogError(message);
          announce(message);
          return;
        }
        attachSkill(attachment, "catalog-install");
        announce(`Installed and attached skill ${attachment.label}`);
      } catch (error) {
        const message = sanitizeSkillBridgeError(
          error,
          "Skill install failed. Try again later.",
        );
        setSkillCatalogError(message);
        announce(message);
      } finally {
        setInstallingSkillId(null);
      }
    },
    [announce, attachSkill],
  );

  const handlePreview = React.useCallback(async () => {
    const patch = buildProfileSkillsPersonaPatch({ target, draft });
    if (!patch.ok) {
      const safeIssues = patch.issues.map(toValidationIssue);
      setBridgeIssues([]);
      setPreviewStatus("idle");
      setPreviewError(null);
      setPreviewItems([]);
      setPersonaPreview(null);
      onValidationStateChange({
        status: "ready",
        issues: safeIssues,
        errorMessage: null,
      });
      onPreviewStateChange({
        status: "idle",
        effective: null,
        diff: [],
        errorMessage: null,
      });
      announce("Skills & Persona needs field fixes before preview");
      return;
    }
    if (!hasSelection) {
      const message =
        "Choose a valid Agent Profile before previewing Skills & Persona.";
      setPreviewStatus("error");
      setPreviewError(message);
      setPreviewItems([]);
      setPersonaPreview(null);
      onPreviewStateChange({
        status: "error",
        effective: null,
        diff: [],
        errorMessage: message,
      });
      announce(message);
      return;
    }

    const baselineContent =
      target.status === "writable" ? target.content : null;
    const profileApi = window.myclaude?.profile;
    const personaApi = window.myclaude?.persona;
    if (!profileApi?.validate || !personaApi?.preview) {
      const message = "Skills & Persona preview is unavailable right now.";
      setPreviewStatus("error");
      setPreviewError(message);
      setPreviewItems(
        createSafeProfileSkillsPersonaPreviewSummary(
          baselineContent,
          patch.content,
        ),
      );
      setPersonaPreview(null);
      onPreviewStateChange({
        status: "error",
        effective: null,
        diff: [],
        errorMessage: message,
      });
      announce("Skills & Persona preview failed");
      return;
    }

    const serializedForPreview = currentSerialized;
    setPreviewStatus("loading");
    setPreviewError(null);
    setSaveError(null);
    onPreviewStateChange({
      status: "loading",
      effective: null,
      diff: [],
      errorMessage: null,
    });
    try {
      const [validationResult, personaPreviewResult] = await Promise.all([
        profileApi.validate({ content: patch.content }),
        personaApi.preview({
          role: selectedRole,
          authProfileId: selectedAuthId,
          cwd,
          draft: { path: patch.path, content: patch.content },
        }),
      ]);
      const validationIssues = sanitizeValidationIssues(
        normalizeValidationIssues(validationResult),
      );
      const personaResult =
        normalizePersonaPreviewResponse(personaPreviewResult);
      const mergedIssues = mergeValidationIssues(
        validationIssues,
        personaResult.issues,
      );
      const summary = createSafeProfileSkillsPersonaPreviewSummary(
        baselineContent,
        patch.content,
      );
      setBridgeIssues(mergedIssues);
      setPreviewItems(summary);
      setPersonaPreview(personaResult.preview);
      onValidationStateChange({
        status: "ready",
        issues: mergedIssues,
        errorMessage: null,
      });

      if (personaResult.status === "error" || mergedIssues.length > 0) {
        const message =
          personaResult.errorMessage ??
          "Skills & Persona preview needs attention.";
        setPreviewStatus("error");
        setPreviewError(message);
        onPreviewStateChange({
          status: "error",
          effective: null,
          diff: [],
          errorMessage: message,
        });
        announce("Skills & Persona preview needs attention");
        return;
      }

      setPreviewStatus("ready");
      setPreviewError(null);
      setPreviewedSerialized(serializedForPreview);
      onPreviewStateChange({
        status: "ready",
        effective: null,
        diff: createPersonaDiffSummary(summary),
        errorMessage: null,
      });
      announce(
        summary.length > 0
          ? "Skills & Persona preview ready"
          : "Skills & Persona preview has no changes",
      );
    } catch (error) {
      const message = formatProfileSkillsPersonaBridgeError(
        error,
        "Skills & Persona preview could not be prepared. Review the selected assets and try again.",
      );
      setBridgeIssues([]);
      setPreviewStatus("error");
      setPreviewError(message);
      setPreviewItems([]);
      setPersonaPreview(null);
      onValidationStateChange({
        status: "error",
        issues: [],
        errorMessage: message,
      });
      onPreviewStateChange({
        status: "error",
        effective: null,
        diff: [],
        errorMessage: message,
      });
      announce("Skills & Persona preview failed");
    }
  }, [
    announce,
    currentSerialized,
    cwd,
    draft,
    hasSelection,
    onPreviewStateChange,
    onValidationStateChange,
    selectedAuthId,
    selectedRole,
    target,
  ]);

  const preparePatchForCurrentDraft = React.useCallback(
    async (profileApi: ProfileBridge) => {
      const listed = await profileApi.list({ cwd, roleFilter: selectedRole });
      const latestTarget = resolveProfileSkillsPersonaTargetFromList({
        listed,
        selectedRole,
        selectedScopePath,
      });
      const validation = validateProfileSkillsPersonaForm({
        target: latestTarget,
        draft,
      });
      if (!validation.ok || latestTarget.status !== "writable") {
        return {
          ok: false as const,
          message: issueMessage(
            validation.issues,
            "Skills & Persona needs a writable profile target.",
          ),
          issues: validation.issues,
        };
      }
      const patch = buildProfileSkillsPersonaPatch({
        target: latestTarget,
        draft,
      });
      if (!patch.ok) {
        return {
          ok: false as const,
          message: issueMessage(
            patch.issues,
            "Fix the highlighted Skills & Persona fields before saving.",
          ),
          issues: patch.issues,
        };
      }
      return { ok: true as const, patch };
    },
    [cwd, draft, selectedRole, selectedScopePath],
  );

  const saveSkillsPersonaDraft =
    React.useCallback(async (): Promise<SkillsPersonaSaveResult> => {
      if (target.status !== "writable") {
        const message = target.message;
        setSaveError(message);
        announce(message);
        return { ok: false, message };
      }
      if (!hasSelection) {
        const message =
          "Choose a valid Agent Profile before saving Skills & Persona.";
        setSaveError(message);
        announce(message);
        return { ok: false, message };
      }
      if (!formValidation.ok || issues.length > 0) {
        const message =
          "Fix the highlighted Skills & Persona fields before saving.";
        setSaveError(message);
        announce(message);
        return { ok: false, message };
      }
      if (!hasCurrentPreview) {
        const message =
          "Preview the current Skills & Persona draft before saving.";
        setSaveError(message);
        announce(message);
        return { ok: false, message };
      }

      const profileApi = window.myclaude?.profile;
      if (!profileApi?.save || !profileApi.list) {
        const message = "Skills & Persona save is unavailable right now.";
        setSaveError(message);
        announce(message);
        return { ok: false, message };
      }

      setIsSaving(true);
      setSaveError(null);
      try {
        const prepared = await preparePatchForCurrentDraft(profileApi);
        if (!prepared.ok) {
          setBridgeIssues(prepared.issues.map(toValidationIssue));
          setSaveError(prepared.message);
          announce(prepared.message);
          return { ok: false, message: prepared.message };
        }

        await profileApi.save({
          path: prepared.patch.path,
          content: prepared.patch.content,
        });
        await onSaved({
          role: selectedRole,
          authProfileId: selectedAuthId,
          cwd,
        });
        setBaselineSerialized(currentSerialized);
        setPreviewedSerialized(null);
        announce("Guided Skills & Persona saved");
        return { ok: true };
      } catch (error) {
        const message = formatProfileSkillsPersonaBridgeError(
          error,
          "Skills & Persona could not be saved. Review the selected assets and try again.",
        );
        setSaveError(message);
        announce(`Skills & Persona save failed: ${message}`);
        return { ok: false, message };
      } finally {
        setIsSaving(false);
      }
    }, [
      announce,
      currentSerialized,
      cwd,
      formValidation.ok,
      hasCurrentPreview,
      hasSelection,
      issues.length,
      onSaved,
      preparePatchForCurrentDraft,
      selectedAuthId,
      selectedRole,
      target,
    ]);

  const saveSkillsPersonaAndClose =
    React.useCallback(async (): Promise<void> => {
      const result = await saveSkillsPersonaDraft();
      if (!result.ok) throw new Error(result.message);
      completeClose(false);
    }, [completeClose, saveSkillsPersonaDraft]);

  const handleSave = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const result = await saveSkillsPersonaDraft();
      if (result.ok) completeClose(false);
    },
    [completeClose, saveSkillsPersonaDraft],
  );

  const discardSkillsPersonaAndClose = React.useCallback(() => {
    completeClose();
  }, [completeClose]);

  React.useEffect(() => {
    if (!open) {
      setSkillsPersonaNavigationGuard(null);
      return;
    }
    setSkillsPersonaNavigationGuard({
      isDirty,
      isSaving,
      canSave: canSaveSkillsPersona,
      saveDisabledReason,
      saveAndClose: saveSkillsPersonaAndClose,
      discardAndClose: discardSkillsPersonaAndClose,
    });
  }, [
    canSaveSkillsPersona,
    discardSkillsPersonaAndClose,
    isDirty,
    isSaving,
    open,
    saveDisabledReason,
    saveSkillsPersonaAndClose,
    setSkillsPersonaNavigationGuard,
  ]);

  React.useEffect(
    () => () => {
      setSkillsPersonaNavigationGuard(null);
    },
    [setSkillsPersonaNavigationGuard],
  );

  const cancelDirtyPrompt = React.useCallback(() => {
    setDirtyPromptOpen(false);
    announce("Stayed in guided Skills & Persona.");
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
  }, [announce]);

  React.useEffect(() => {
    if (!dirtyPromptOpen) return;
    const frameId = window.requestAnimationFrame(() => {
      dirtyCancelButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [dirtyPromptOpen]);

  const discardDirtyPromptAndContinue = React.useCallback(() => {
    const continuation = pendingLeaveContinuationRef.current;
    announce("Discarded Skills & Persona changes.");
    completeCloseAndContinue(continuation, false);
  }, [announce, completeCloseAndContinue]);

  const saveDirtyPromptAndContinue = React.useCallback(async () => {
    const continuation = pendingLeaveContinuationRef.current;
    const result = await saveSkillsPersonaDraft();
    if (!result.ok) return;
    completeCloseAndContinue(continuation, false);
  }, [completeCloseAndContinue, saveSkillsPersonaDraft]);

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
    target.status === "writable"
      ? "success"
      : target.status === "invalid"
        ? "danger"
        : "warning";
  const previewTone =
    previewStatus === "ready"
      ? previewItems.length > 0
        ? "info"
        : "success"
      : previewStatus === "error"
        ? "danger"
        : previewStatus === "loading" || previewStatus === "pending"
          ? "warning"
          : "neutral";
  const targetMessage =
    target.status === "writable"
      ? "Guided Skills & Persona will update persona assets on the selected Agent Profile only."
      : target.message;

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm"
        aria-hidden="true"
      />
      <dialog
        aria-describedby="profile-skills-persona-description"
        aria-labelledby="profile-skills-persona-title"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-full max-w-6xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-lg focus-visible:outline-none"
        data-testid="profile-skills-persona-panel"
        onCancel={(event: React.SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault();
          requestLeave(null);
        }}
        open
      >
        <form
          className="flex max-h-[92vh] min-h-0 flex-col"
          onSubmit={handleSave}
        >
          <header className="border-b border-subtle bg-surface/95 px-6 py-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <IconFrame icon={Sparkles} size="sm" tone="accent" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
                    Guided Skills & Persona
                  </p>
                  <h2
                    className="mt-1 text-xl font-semibold tracking-[-0.02em] text-primary"
                    id="profile-skills-persona-title"
                  >
                    Customize skills & persona for {profile.name}
                  </h2>
                  <p
                    className="mt-1 text-sm leading-6 text-secondary"
                    id="profile-skills-persona-description"
                  >
                    Attach profile-owned skills, instructions, agents, commands,
                    and memory with safe previews before saving.
                  </p>
                </div>
              </div>
              <Button
                aria-label="Close Skills & Persona"
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
              <section
                className="rounded-xl border border-default bg-canvas/60 p-4"
                data-testid="profile-skills-persona-target"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-primary">
                      Target status
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-secondary">
                      {targetMessage}
                    </p>
                  </div>
                  <StatusChip tone={targetTone}>
                    {target.status === "writable"
                      ? "Ready to edit"
                      : "Needs advanced edit"}
                  </StatusChip>
                </div>
                {target.status !== "writable" ? (
                  <div className="mt-4">
                    <Button
                      data-testid="profile-skills-persona-open-advanced"
                      onClick={() => requestLeave(onOpenAdvanced)}
                      type="button"
                      variant="secondary"
                    >
                      Open Profile Workspace
                    </Button>
                  </div>
                ) : null}
              </section>

              {PROFILE_SKILLS_PERSONA_CATEGORIES.map((category) => (
                <CategorySection
                  category={category}
                  disabled={target.status !== "writable" || isSaving}
                  issuesByField={issuesByField}
                  key={category}
                  onAdd={() => addRow(category)}
                  onLoadInstalled={
                    category === "skills" ? loadInstalledSkills : undefined
                  }
                  onSearchSkills={
                    category === "skills" ? searchSkills : undefined
                  }
                  onSkillQueryChange={
                    category === "skills" ? setSkillQuery : undefined
                  }
                  onInstallSkill={
                    category === "skills" ? installSkill : undefined
                  }
                  onAttachSkill={
                    category === "skills" ? attachInstalledSkill : undefined
                  }
                  onRemove={removeRow}
                  onUpdate={updateRow}
                  rows={draft.rows.filter((row) => row.category === category)}
                  initialFocusRef={
                    category === "skills" ? initialFocusRef : undefined
                  }
                  installedSkills={installedSkills}
                  installedStatus={installedStatus}
                  installingSkillId={installingSkillId}
                  skillCatalogError={skillCatalogError}
                  skillQuery={skillQuery}
                  skillResults={skillResults}
                  skillSearchStatus={skillSearchStatus}
                />
              ))}
            </div>

            <aside className="border-t border-subtle bg-canvas/65 px-6 py-5 lg:border-l lg:border-t-0">
              <section
                aria-live="polite"
                className="sticky top-0 grid gap-4"
                data-preview-status={previewStatus}
                data-testid="profile-skills-persona-preview"
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
                        <h3 className="text-sm font-semibold text-primary">
                          Preview composed persona
                        </h3>
                        <span data-testid="profile-skills-persona-preview-status">
                          <StatusChip tone={previewTone}>
                            {formatPreviewStatus(previewStatus)}
                          </StatusChip>
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-secondary">
                        {previewStatus === "loading"
                          ? "Checking the guided Skills & Persona draft…"
                          : previewStatus === "pending"
                            ? "Preview the current draft before saving."
                            : previewStatus === "error"
                              ? previewError
                              : issues.length > 0 || !hasSelection
                                ? "Fix validation issues to preview safely."
                                : previewItems.length > 0
                                  ? `${previewItems.length} safe Skills & Persona change${previewItems.length === 1 ? "" : "s"} ready to review.`
                                  : "No Skills & Persona preview has been requested yet."}
                      </p>
                    </div>
                  </div>

                  {previewItems.length > 0 ? (
                    <ul className="mt-4 grid gap-2">
                      {previewItems.slice(0, 12).map((item, index) => (
                        <li
                          className="rounded-md border border-subtle bg-canvas/70 px-3 py-2 text-sm text-secondary"
                          key={`${item.category}:${item.label}:${item.change}:${index}`}
                        >
                          <span className="font-medium text-primary">
                            {formatPreviewChange(item.change)}
                          </span>{" "}
                          {CATEGORY_CONFIG[item.category].label} · {item.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {personaPreview ? (
                    <PersonaPreviewDetails preview={personaPreview} />
                  ) : null}
                </div>

                <div className="rounded-xl border border-default bg-surface p-4">
                  <h3 className="text-sm font-semibold text-primary">
                    Save readiness
                  </h3>
                  <ul className="mt-3 grid gap-2 text-sm text-secondary">
                    <ReadinessLine ok={target.status === "writable"}>
                      Writable profile target
                    </ReadinessLine>
                    <ReadinessLine ok={hasSelection}>
                      Selected profile still available
                    </ReadinessLine>
                    <ReadinessLine ok={formValidation.ok}>
                      Valid persona rows
                    </ReadinessLine>
                    <ReadinessLine ok={hasCurrentPreview}>
                      Current draft previewed
                    </ReadinessLine>
                  </ul>
                </div>

                {issues.length > 0 ||
                saveError ||
                !hasSelection ||
                target.status !== "writable" ? (
                  <div
                    className="rounded-xl border border-status-danger bg-status-danger-soft p-4 text-sm text-status-danger"
                    data-testid="profile-skills-persona-error"
                    role="alert"
                  >
                    <p className="font-semibold">
                      Skills & Persona needs attention
                    </p>
                    <ul className="mt-2 grid gap-1">
                      {target.status !== "writable" ? (
                        <li>{target.message}</li>
                      ) : null}
                      {!hasSelection ? (
                        <li>
                          Choose a valid Agent Profile before saving Skills &
                          Persona.
                        </li>
                      ) : null}
                      {issues.slice(0, 5).map((issue, index) => (
                        <li key={`${issue.path}:${index}`}>{issue.message}</li>
                      ))}
                      {saveError ? (
                        <li data-testid="profile-skills-persona-save-error">
                          {saveError}
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>

          <div className="flex flex-row flex-wrap justify-end gap-2 border-t border-subtle bg-surface/95 px-6 py-4">
            <Button
              data-testid="profile-skills-persona-cancel"
              disabled={isSaving}
              onClick={() => requestLeave(null)}
              ref={cancelButtonRef}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              data-testid="profile-skills-persona-preview-action"
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
              Preview Skills & Persona
            </Button>
            <Button
              data-testid="profile-skills-persona-save"
              disabled={saveDisabled}
              type="submit"
              variant="primary"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSaving ? "Saving…" : "Save Skills & Persona"}
            </Button>
          </div>
        </form>
      </dialog>

      {dirtyPromptOpen ? (
        <>
          <div
            className="fixed inset-0 z-[60] bg-overlay/80 backdrop-blur-sm"
            aria-hidden="true"
          />
          <dialog
            aria-describedby="profile-skills-persona-dirty-description"
            aria-labelledby="profile-skills-persona-dirty-title"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 z-[61] grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border border-border bg-popover p-6 text-popover-foreground shadow-lg"
            data-testid="profile-skills-persona-dirty-dialog"
            open
          >
            <header className="flex flex-col gap-1.5">
              <h2
                className="text-base font-semibold text-foreground"
                id="profile-skills-persona-dirty-title"
              >
                Save Skills & Persona changes?
              </h2>
              <p
                className="text-sm text-muted-foreground"
                id="profile-skills-persona-dirty-description"
              >
                You have unsaved guided Skills & Persona edits. Save before
                leaving, discard the draft, or stay here to keep editing.
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
                data-testid="profile-skills-persona-dirty-cancel"
                disabled={isSaving}
                onClick={cancelDirtyPrompt}
                ref={dirtyCancelButtonRef}
                type="button"
                variant="ghost"
              >
                Keep editing
              </Button>
              <Button
                data-testid="profile-skills-persona-dirty-discard"
                disabled={isSaving}
                onClick={discardDirtyPromptAndContinue}
                type="button"
                variant="secondary"
              >
                Discard changes
              </Button>
              <Button
                data-testid="profile-skills-persona-dirty-save"
                disabled={!canSaveSkillsPersona || isSaving}
                onClick={() => void saveDirtyPromptAndContinue()}
                type="button"
                variant="primary"
              >
                {isSaving ? "Saving…" : "Save Skills & Persona"}
              </Button>
            </div>
          </dialog>
        </>
      ) : null}
    </>
  );
}

function CategorySection({
  category,
  disabled,
  installedSkills,
  installedStatus,
  installingSkillId,
  issuesByField,
  initialFocusRef,
  onAdd,
  onAttachSkill,
  onInstallSkill,
  onLoadInstalled,
  onRemove,
  onSearchSkills,
  onSkillQueryChange,
  onUpdate,
  rows,
  skillCatalogError,
  skillQuery,
  skillResults,
  skillSearchStatus,
}: {
  category: ProfileSkillsPersonaCategory;
  disabled: boolean;
  installedSkills: readonly SkillCatalogItem[];
  installedStatus: SkillsPersonaAsyncStatus;
  installingSkillId: string | null;
  issuesByField: Partial<
    Record<ProfileSkillsPersonaValidationIssue["field"], string>
  >;
  initialFocusRef?: React.Ref<HTMLButtonElement> | undefined;
  onAdd: () => void;
  onAttachSkill?: ((skill: SkillCatalogItem) => void) | undefined;
  onInstallSkill?: ((skill: SkillCatalogItem) => void) | undefined;
  onLoadInstalled?: (() => void) | undefined;
  onRemove: (rowId: string) => void;
  onSearchSkills?: (() => void) | undefined;
  onSkillQueryChange?: ((query: string) => void) | undefined;
  onUpdate: (
    rowId: string,
    patch: Partial<Pick<ProfileSkillsPersonaDraftRow, "category" | "ref">>,
  ) => void;
  rows: readonly ProfileSkillsPersonaDraftRow[];
  skillCatalogError: string | null;
  skillQuery: string;
  skillResults: readonly SkillCatalogItem[];
  skillSearchStatus: SkillsPersonaAsyncStatus;
}): React.ReactElement {
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  return (
    <section
      className="rounded-xl border border-default bg-surface p-4"
      data-testid={`profile-skills-persona-section-${category}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Icon className="h-4 w-4 text-secondary" aria-hidden="true" />
            {config.label}
          </h3>
          <p className="mt-1 text-sm leading-6 text-secondary">
            {config.description}
          </p>
        </div>
        <Button
          data-testid={`profile-skills-persona-add-${category}`}
          disabled={disabled}
          onClick={onAdd}
          ref={initialFocusRef}
          type="button"
          variant="secondary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {config.addLabel}
        </Button>
      </div>

      {issuesByField.ref ? (
        <p className="mt-3 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
          {issuesByField.ref}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {rows.map((row, index) => {
            const isOpaqueSkillRow =
              row.category === "skills" &&
              isProfileSkillsPersonaOpaqueSkillRef(row.ref);
            const categoryControlId = `profile-skills-persona-category-${row.id}`;
            const refControlId = `profile-skills-persona-ref-${row.id}`;
            return (
              <div
                className="rounded-lg border border-subtle bg-canvas/60 p-3"
                data-testid="profile-skills-persona-row"
                key={row.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
                      {config.noun} {index + 1}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium text-primary">
                      {safeRowLabel(row, category)}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remove ${config.noun} ${index + 1}`}
                    className="min-h-10"
                    disabled={disabled}
                    onClick={() => onRemove(row.id)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[11rem_minmax(0,1fr)]">
                  <Field label="Category" htmlFor={categoryControlId}>
                    <select
                      aria-label={`${config.noun} ${index + 1} category`}
                      className="min-h-10 rounded-md border border-default bg-canvas px-3 text-sm text-primary shadow-xs focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disabled || isOpaqueSkillRow}
                      id={categoryControlId}
                      onChange={(event) =>
                        onUpdate(row.id, {
                          category: event.currentTarget
                            .value as ProfileSkillsPersonaCategory,
                        })
                      }
                      value={row.category}
                    >
                      {PROFILE_SKILLS_PERSONA_CATEGORIES.map((option) => (
                        <option key={option} value={option}>
                          {CATEGORY_CONFIG[option].label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {isOpaqueSkillRow ? (
                    <Field
                      description="Installed skill references are managed safely by the skills bridge. Remove this row to replace it."
                      label="Attached skill"
                    >
                      <div
                        className="min-h-10 rounded-md border border-subtle bg-canvas px-3 py-2 text-sm font-medium text-primary"
                        data-testid="profile-skills-persona-safe-skill-ref"
                      >
                        {safeRowLabel(row, category)}
                      </div>
                    </Field>
                  ) : (
                    <Field
                      description="Use a safe asset reference. Credentials and raw local paths are blocked."
                      htmlFor={refControlId}
                      label="Asset reference"
                      {...fieldErrorProps(issuesByField.ref)}
                    >
                      <Input
                        aria-invalid={issuesByField.ref ? true : undefined}
                        className="font-mono text-xs"
                        data-testid="profile-skills-persona-ref-input"
                        disabled={disabled}
                        id={refControlId}
                        onChange={(event) =>
                          onUpdate(row.id, { ref: event.currentTarget.value })
                        }
                        placeholder={
                          CATEGORY_CONFIG[row.category]?.placeholder ??
                          config.placeholder
                        }
                        value={row.ref}
                      />
                    </Field>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className="mt-4 rounded-lg border border-dashed border-subtle bg-canvas/60 px-4 py-6 text-sm text-secondary"
          data-testid={`profile-skills-persona-empty-${category}`}
        >
          {config.empty}
        </p>
      )}

      {category === "skills" ? (
        <SkillCatalogPanel
          disabled={disabled}
          installedSkills={installedSkills}
          installedStatus={installedStatus}
          installingSkillId={installingSkillId}
          onAttachSkill={onAttachSkill}
          onInstallSkill={onInstallSkill}
          onLoadInstalled={onLoadInstalled}
          onSearchSkills={onSearchSkills}
          onSkillQueryChange={onSkillQueryChange}
          skillCatalogError={skillCatalogError}
          skillQuery={skillQuery}
          skillResults={skillResults}
          skillSearchStatus={skillSearchStatus}
        />
      ) : null}
    </section>
  );
}

function SkillCatalogPanel({
  disabled,
  installedSkills,
  installedStatus,
  installingSkillId,
  onAttachSkill,
  onInstallSkill,
  onLoadInstalled,
  onSearchSkills,
  onSkillQueryChange,
  skillCatalogError,
  skillQuery,
  skillResults,
  skillSearchStatus,
}: {
  disabled: boolean;
  installedSkills: readonly SkillCatalogItem[];
  installedStatus: SkillsPersonaAsyncStatus;
  installingSkillId: string | null;
  onAttachSkill?: ((skill: SkillCatalogItem) => void) | undefined;
  onInstallSkill?: ((skill: SkillCatalogItem) => void) | undefined;
  onLoadInstalled?: (() => void) | undefined;
  onSearchSkills?: (() => void) | undefined;
  onSkillQueryChange?: ((query: string) => void) | undefined;
  skillCatalogError: string | null;
  skillQuery: string;
  skillResults: readonly SkillCatalogItem[];
  skillSearchStatus: SkillsPersonaAsyncStatus;
}): React.ReactElement {
  return (
    <section
      className="mt-4 rounded-lg border border-subtle bg-canvas/60 p-3"
      data-testid="profile-skills-persona-skill-catalog"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary">
            Installed and catalog skills
          </h4>
          <p className="mt-1 text-sm text-secondary">
            Load installed skills or search the catalog, then attach by safe
            skill name.
          </p>
        </div>
        <Button
          data-testid="profile-skills-persona-load-installed"
          disabled={disabled || installedStatus === "loading"}
          onClick={onLoadInstalled}
          type="button"
          variant="secondary"
        >
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          {installedStatus === "loading" ? "Loading…" : "Load installed"}
        </Button>
      </div>
      {skillCatalogError ? (
        <p
          className="mt-3 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger"
          data-testid="profile-skills-persona-skill-error"
          role="alert"
        >
          {skillCatalogError}
        </p>
      ) : null}
      {installedStatus === "ready" ? (
        <SkillList
          empty="No installed skills were found."
          items={installedSkills}
          onAttach={onAttachSkill}
          disabled={disabled}
        />
      ) : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          aria-label="Search skill catalog"
          data-testid="profile-skills-persona-skill-search-input"
          disabled={disabled || skillSearchStatus === "loading"}
          onChange={(event) => onSkillQueryChange?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearchSkills?.();
            }
          }}
          placeholder="Search skills"
          value={skillQuery}
        />
        <Button
          disabled={disabled || skillSearchStatus === "loading"}
          onClick={onSearchSkills}
          type="button"
          variant="secondary"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {skillSearchStatus === "loading" ? "Searching…" : "Search"}
        </Button>
      </div>
      {skillSearchStatus === "ready" ? (
        <div className="mt-3 grid gap-2">
          {skillResults.length > 0 ? (
            skillResults.map((skill) => {
              const description = safeSkillDescription(skill.description);
              return (
                <div
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-subtle bg-surface px-3 py-2 text-sm"
                  data-testid="profile-skills-persona-catalog-skill"
                  key={skill.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-primary">
                      {safeSkillName(skill)}
                    </p>
                    {description ? (
                      <p className="mt-1 line-clamp-2 text-secondary">
                        {description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    data-testid="profile-skills-persona-install-skill"
                    disabled={disabled || installingSkillId === skill.id}
                    onClick={() => onInstallSkill?.(skill)}
                    size="sm"
                    type="button"
                    variant="primary"
                  >
                    <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    {installingSkillId === skill.id ? "Installing…" : "Install"}
                  </Button>
                </div>
              );
            })
          ) : (
            <p className="rounded-md border border-dashed border-subtle bg-canvas/60 px-3 py-4 text-sm text-secondary">
              No catalog skills matched that search.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SkillList({
  disabled,
  empty,
  items,
  onAttach,
}: {
  disabled: boolean;
  empty: string;
  items: readonly SkillCatalogItem[];
  onAttach?: ((skill: SkillCatalogItem) => void) | undefined;
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-dashed border-subtle bg-canvas/60 px-3 py-4 text-sm text-secondary">
        {empty}
      </p>
    );
  }
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.map((skill) => (
        <li
          className="flex items-center justify-between gap-3 rounded-md border border-subtle bg-surface px-3 py-2 text-sm"
          data-testid="profile-skills-persona-installed-skill"
          key={skill.id}
        >
          <span className="min-w-0 truncate font-medium text-primary">
            {safeSkillName(skill)}
          </span>
          <Button
            data-testid="profile-skills-persona-attach-installed-skill"
            disabled={disabled}
            onClick={() => onAttach?.(skill)}
            size="sm"
            type="button"
            variant="secondary"
          >
            Attach
          </Button>
        </li>
      ))}
    </ul>
  );
}

function PersonaPreviewDetails({
  preview,
}: {
  preview: PersonaPreviewPayload;
}): React.ReactElement {
  const warnings = [...preview.missingSources, ...preview.collisions];
  return (
    <div className="mt-4 grid gap-3">
      <dl className="grid grid-cols-2 gap-2">
        {preview.categoryCounts.map((item) => (
          <div
            className="rounded-md border border-subtle bg-canvas/70 px-3 py-2"
            key={item.category}
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-tertiary">
              {CATEGORY_CONFIG[item.category].label}
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-primary tabular-nums">
              {item.count}
            </dd>
          </div>
        ))}
      </dl>
      {preview.basenames.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
            Previewed assets
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {preview.basenames.slice(0, 12).map((item, index) => (
              <li
                className="rounded-full border border-subtle bg-canvas/70 px-2.5 py-1 text-xs font-medium text-primary"
                key={`${item.category}:${item.basename}:${index}`}
              >
                {CATEGORY_CONFIG[item.category].label} · {item.basename}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
            Warnings
          </p>
          <ul className="mt-2 grid gap-2">
            {preview.missingSources.map((item, index) => (
              <li
                className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning"
                data-testid="profile-skills-persona-missing-source-warning"
                key={`missing:${item.category}:${item.basename}:${index}`}
              >
                {CATEGORY_CONFIG[item.category].label} · {item.basename} ·
                Source could not be found.
              </li>
            ))}
            {preview.collisions.map((item, index) => (
              <li
                className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning"
                data-testid="profile-skills-persona-collision-warning"
                key={`collision:${item.category}:${item.basename}:${index}`}
              >
                {CATEGORY_CONFIG[item.category].label} · {item.basename} ·{" "}
                {item.hiddenCount} hidden source
                {item.hiddenCount === 1 ? "" : "s"}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.metrics.truncatedItemCount > 0 ? (
        <p className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning">
          {preview.metrics.truncatedItemCount} additional preview item
          {preview.metrics.truncatedItemCount === 1 ? "" : "s"} hidden to keep
          this panel calm.
        </p>
      ) : null}
    </div>
  );
}

function ReadinessLine({
  children,
  ok,
}: {
  children: React.ReactNode;
  ok: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2
          className="h-4 w-4 text-status-success"
          aria-hidden="true"
        />
      ) : (
        <AlertTriangle
          className="h-4 w-4 text-status-warning"
          aria-hidden="true"
        />
      )}
      <span className={ok ? "text-secondary" : "text-status-warning"}>
        {children}
      </span>
    </li>
  );
}

function serializeDraft(draft: ProfileSkillsPersonaDraft): string {
  return stableStringify({
    rows: draft.rows.map((row) => ({ category: row.category, ref: row.ref })),
  });
}

function mapIssuesByField(
  issues: readonly {
    field: ProfileSkillsPersonaValidationIssue["field"];
    message: string;
  }[],
): Partial<Record<ProfileSkillsPersonaValidationIssue["field"], string>> {
  const byField: Partial<
    Record<ProfileSkillsPersonaValidationIssue["field"], string>
  > = {};
  for (const issue of issues) byField[issue.field] ??= issue.message;
  return byField;
}

function toProfileSkillsPersonaIssue(
  issue: ValidationIssue,
): ProfileSkillsPersonaValidationIssue {
  return {
    field: "target",
    path: safeIssuePath(issue.path),
    message: safeValidationMessage(issue),
    severity: "error",
  };
}

function toValidationIssue(
  issue: ProfileSkillsPersonaValidationIssue,
): ValidationIssue {
  return {
    path: safeIssuePath(issue.path),
    message: issue.message,
    severity: issue.severity,
  };
}

function sanitizeValidationIssues(
  issues: readonly ValidationIssue[],
): ValidationIssue[] {
  return issues.map((issue, index) => ({
    path: safeIssuePath(issue.path || `profile-skills-persona.${index + 1}`),
    severity: issue.severity || "error",
    message: safeValidationMessage(issue),
  }));
}

function safeIssuePath(path: string): string {
  if (UNSAFE_VISIBLE_TEXT_RE.test(path)) return "profile-skills-persona";
  return path || "profile-skills-persona";
}

function safeValidationMessage(issue: ValidationIssue): string {
  if (
    UNSAFE_VISIBLE_TEXT_RE.test(issue.message) ||
    UNSAFE_VISIBLE_TEXT_RE.test(issue.path)
  ) {
    return "Skills & Persona needs a safe asset reference before saving.";
  }
  if (
    /persona|skill|agent|command|memory|preview|render|source|collision/i.test(
      issue.message,
    )
  ) {
    return issue.message;
  }
  return "Skills & Persona needs a safe value before saving.";
}

function normalizePersonaPreviewResponse(
  input: unknown,
): PersonaPreviewAdapterResult {
  if (!isRecord(input)) {
    return {
      status: "error",
      issues: [],
      preview: null,
      errorMessage: "Skills & Persona preview returned an invalid response.",
    };
  }
  const issues = sanitizeValidationIssues(
    normalizeValidationIssues(input.issues ?? []),
  );
  const preview = normalizePersonaPreviewPayload(input.preview);
  const failure = normalizePersonaPreviewFailure(input.failure);
  if (failure) {
    return { status: "error", issues, preview, errorMessage: failure };
  }
  if (input.preview !== null && !preview) {
    return {
      status: "error",
      issues,
      preview: null,
      errorMessage: "Skills & Persona preview returned a malformed response.",
    };
  }
  return { status: "ready", issues, preview, errorMessage: null };
}

function normalizePersonaPreviewPayload(
  input: unknown,
): PersonaPreviewPayload | null {
  if (!isRecord(input)) return null;
  const metricsInput = isRecord(input.metrics) ? input.metrics : {};
  return {
    categoryCounts: readArray(input.categoryCounts)
      .map(normalizeCategoryCount)
      .filter(isNonNull),
    basenames: readArray(input.basenames)
      .map(normalizeBasename)
      .filter(isNonNull),
    missingSources: readArray(input.missingSources)
      .map(normalizeMissingSource)
      .filter(isNonNull),
    collisions: readArray(input.collisions)
      .map(normalizeCollision)
      .filter(isNonNull),
    metrics: {
      claudeMdSectionCount: readNonNegativeNumber(
        metricsInput.claudeMdSectionCount,
      ),
      claudeMdCharacterCount: readNonNegativeNumber(
        metricsInput.claudeMdCharacterCount,
      ),
      fileCount: readNonNegativeNumber(metricsInput.fileCount),
      fileCharacterCount: readNonNegativeNumber(
        metricsInput.fileCharacterCount,
      ),
      totalCharacterCount: readNonNegativeNumber(
        metricsInput.totalCharacterCount,
      ),
      truncatedItemCount: readNonNegativeNumber(
        metricsInput.truncatedItemCount,
      ),
    },
  };
}

function normalizePersonaPreviewFailure(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const message = typeof input.message === "string" ? input.message : "";
  if (!message || UNSAFE_VISIBLE_TEXT_RE.test(message)) {
    return "Skills & Persona preview could not be prepared. Review the selected assets and try again.";
  }
  return message;
}

function normalizeCategoryCount(
  input: unknown,
): PersonaPreviewCategoryCount | null {
  if (!isRecord(input) || !isCategory(input.category)) return null;
  return {
    category: input.category,
    count: readNonNegativeNumber(input.count),
  };
}

function normalizeBasename(input: unknown): PersonaPreviewBasename | null {
  if (!isRecord(input) || !isCategory(input.category)) return null;
  const basename = safeVisibleSegment(input.basename);
  return basename ? { category: input.category, basename } : null;
}

function normalizeMissingSource(
  input: unknown,
): PersonaPreviewMissingSourceWarning | null {
  if (!isRecord(input) || !isCategory(input.category)) return null;
  const basename = safeVisibleSegment(input.basename);
  return basename
    ? {
        category: input.category,
        basename,
        count: Math.max(1, readNonNegativeNumber(input.count)),
      }
    : null;
}

function normalizeCollision(
  input: unknown,
): PersonaPreviewCollisionWarning | null {
  if (!isRecord(input) || !isFileCategory(input.category)) return null;
  const basename = safeVisibleSegment(input.basename);
  return basename
    ? {
        category: input.category,
        basename,
        hiddenCount: Math.max(1, readNonNegativeNumber(input.hiddenCount)),
      }
    : null;
}

function createPersonaDiffSummary(
  items: readonly ProfileSkillsPersonaPreviewSummaryItem[],
): DiffItem[] {
  return items.map((item) => ({
    section: "persona",
    key: `${CATEGORY_CONFIG[item.category].label} · ${item.label}`,
    change: item.change,
  }));
}

function mergeValidationIssues(
  ...issueLists: Array<readonly ValidationIssue[]>
): ValidationIssue[] {
  const seen = new Set<string>();
  const merged: ValidationIssue[] = [];
  for (const issues of issueLists) {
    for (const issue of issues) {
      const key = `${issue.path}\0${issue.message}\0${issue.severity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(issue);
    }
  }
  return merged;
}

function getSaveDisabledReason(input: {
  targetStatus: ProfileSkillsPersonaTarget["status"];
  hasBlockingIssues: boolean;
  hasCurrentPreview: boolean;
  hasSelection: boolean;
  isDirty: boolean;
  isSaving: boolean;
  previewStatus: SkillsPersonaAsyncStatus;
}): string | null {
  if (input.targetStatus !== "writable")
    return "Skills & Persona needs a writable profile target.";
  if (!input.hasSelection)
    return "Choose a valid Agent Profile before saving Skills & Persona.";
  if (!input.isDirty) return "No Skills & Persona changes to save.";
  if (input.hasBlockingIssues)
    return "Fix the highlighted Skills & Persona fields before saving.";
  if (input.previewStatus === "loading" || input.previewStatus === "pending")
    return "Wait for Skills & Persona preview to finish checking.";
  if (!input.hasCurrentPreview)
    return "Preview the current Skills & Persona draft before saving.";
  if (input.isSaving) return "Skills & Persona is saving.";
  return null;
}

function issueMessage(
  issues: readonly ProfileSkillsPersonaValidationIssue[],
  fallback: string,
): string {
  return (
    issues.find((issue) => issue.field === "target")?.message ??
    issues[0]?.message ??
    fallback
  );
}

function fieldErrorProps(
  error: string | null | undefined,
): { error: string } | Record<string, never> {
  return error ? { error } : {};
}

function formatPreviewStatus(status: SkillsPersonaAsyncStatus): string {
  if (status === "loading") return "Checking";
  if (status === "pending") return "Stale";
  if (status === "ready") return "Ready";
  if (status === "error") return "Needs attention";
  return "Waiting";
}

function formatPreviewChange(
  change: ProfileSkillsPersonaPreviewSummaryItem["change"],
): string {
  if (change === "added") return "Adds";
  if (change === "removed") return "Removes";
  return "Changes";
}

function safeRowLabel(
  row: ProfileSkillsPersonaDraftRow,
  category: ProfileSkillsPersonaCategory,
): string {
  return (
    safeVisibleSegment(row.displayLabel) ??
    safeVisibleSegment(row.ref.split(/[\\/]/).filter(Boolean).at(-2)) ??
    safeVisibleSegment(row.ref.split(/[\\/]/).pop()) ??
    CATEGORY_CONFIG[category].noun
  );
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function isCategory(value: unknown): value is ProfileSkillsPersonaCategory {
  return (
    typeof value === "string" &&
    PROFILE_SKILLS_PERSONA_CATEGORIES.includes(
      value as ProfileSkillsPersonaCategory,
    )
  );
}

function isFileCategory(
  value: unknown,
): value is Exclude<ProfileSkillsPersonaCategory, "claudeMd"> {
  return (
    value === "agents" ||
    value === "skills" ||
    value === "slashCmds" ||
    value === "memory"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

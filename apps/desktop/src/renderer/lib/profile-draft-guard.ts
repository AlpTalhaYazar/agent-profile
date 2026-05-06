import { useAtomValue, useSetAtom } from "jotai";
import * as React from "react";
import {
  draftDocAtom,
  hasUnsavedChangesAtom,
  isSavingAtom,
  jsonStateAtom,
  originalDocAtom,
  previewStateAtom,
  profileBasicsNavigationGuardAtom,
  scopeEntriesAtom,
  selectedScopeAtom,
  settingsParseErrorAtom,
  settingsTextAtom,
  validationStateAtom,
} from "./atoms.js";
import { cloneDoc, stringifyDoc, stringifyValue } from "./clone.js";
import { getErrorMessage } from "./normalize.js";
import { formatProfileBasicsBridgeError } from "./profile-basics.js";

export type ProfileDraftGuardSource = "layers" | "basics";

export interface ProfileDraftNavigationGuard {
  open: boolean;
  busy: boolean;
  errorMessage: string | null;
  canSave: boolean;
  saveDisabledReason: string | null;
  title: string;
  description: string;
  request: (continuation: () => void, options?: ProfileDraftGuardRequestOptions) => void;
  cancel: () => void;
  discardAndContinue: () => void;
  saveAndContinue: () => Promise<void>;
}

export interface ProfileDraftGuardRequestOptions {
  returnFocusTo?: HTMLElement | null | undefined;
}

export interface ProfileDraftGuardBasicsState {
  isDirty: boolean;
  canSave: boolean;
  saveDisabledReason: string | null;
}

export interface ProfileDraftGuardSnapshotInput {
  hasLayerChanges: boolean;
  layerCanSave: boolean;
  layerSaveDisabledReason: string | null;
  basics: ProfileDraftGuardBasicsState | null | undefined;
  preferredSource?: ProfileDraftGuardSource | null;
}

export interface ProfileDraftGuardSnapshot {
  source: ProfileDraftGuardSource | null;
  hasChanges: boolean;
  canSave: boolean;
  saveDisabledReason: string | null;
  title: string;
  description: string;
  cancelAnnouncement: string;
  discardAnnouncement: string;
  saveAnnouncement: string;
  saveFailurePrefix: string;
  saveFailureFallback: string;
}

const LAYER_DIALOG_COPY = {
  title: "Save profile changes?",
  description:
    "This profile has unsaved layer changes. Save before leaving, discard the draft, or stay here to keep editing.",
  cancelAnnouncement: "Stayed on the current profile draft.",
  discardAnnouncement: "Discarded profile changes.",
  saveAnnouncement: "Saved profile changes.",
  saveFailurePrefix: "Save failed",
  saveFailureFallback: "Profile changes could not be saved. Review the draft and try again.",
};

const BASICS_DIALOG_COPY = {
  title: "Save Profile Basics changes?",
  description:
    "Guided Profile Basics has unsaved edits. Save before leaving, discard the draft, or stay here to keep editing.",
  cancelAnnouncement: "Stayed in guided Profile Basics.",
  discardAnnouncement: "Discarded Profile Basics changes.",
  saveAnnouncement: "Saved Profile Basics changes.",
  saveFailurePrefix: "Profile Basics save failed",
  saveFailureFallback: "Profile Basics could not be saved. Review the fields and try again.",
};

const DEFAULT_DIALOG_COPY = LAYER_DIALOG_COPY;

export function resolveProfileDraftGuardSnapshot({
  basics,
  hasLayerChanges,
  layerCanSave,
  layerSaveDisabledReason,
  preferredSource,
}: ProfileDraftGuardSnapshotInput): ProfileDraftGuardSnapshot {
  const source =
    preferredSource ?? (hasLayerChanges ? "layers" : basics?.isDirty ? "basics" : null);
  const copy = getDialogCopy(source);

  if (source === "layers") {
    return {
      source,
      hasChanges: hasLayerChanges,
      canSave: hasLayerChanges && layerCanSave,
      saveDisabledReason: hasLayerChanges && !layerCanSave ? layerSaveDisabledReason : null,
      ...copy,
    };
  }

  if (source === "basics") {
    const hasBasicsChanges = Boolean(basics?.isDirty);
    const basicsCanSave = Boolean(hasBasicsChanges && basics?.canSave);
    return {
      source,
      hasChanges: hasBasicsChanges,
      canSave: basicsCanSave,
      saveDisabledReason:
        hasBasicsChanges && !basicsCanSave
          ? (basics?.saveDisabledReason ?? "Profile Basics cannot be saved yet.")
          : null,
      ...copy,
    };
  }

  return {
    source: null,
    hasChanges: false,
    canSave: false,
    saveDisabledReason: null,
    ...copy,
  };
}

export function formatProfileDraftGuardError(
  error: unknown,
  source: ProfileDraftGuardSource
): string {
  if (source === "basics") {
    return formatProfileBasicsBridgeError(error, BASICS_DIALOG_COPY.saveFailureFallback);
  }
  const message = getErrorMessage(error);
  if (containsUnsafeGuardDiagnosticText(message)) return LAYER_DIALOG_COPY.saveFailureFallback;
  return message;
}

function containsUnsafeGuardDiagnosticText(message: string): boolean {
  return /\.myclaude|project-role|global-role|keyring:\/\/|\$\{secret:|\$\{env:|secretRef|bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|oauth|authorization/i.test(
    message
  );
}

export function useProfileDraftNavigationGuard(options: {
  announce: (message: string) => void;
}): ProfileDraftNavigationGuard {
  const { announce } = options;
  const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom);
  const basicsGuard = useAtomValue(profileBasicsNavigationGuardAtom);
  const selectedScope = useAtomValue(selectedScopeAtom);
  const draftDoc = useAtomValue(draftDocAtom);
  const originalDoc = useAtomValue(originalDocAtom);
  const jsonState = useAtomValue(jsonStateAtom);
  const settingsParseError = useAtomValue(settingsParseErrorAtom);
  const setDraftDoc = useSetAtom(draftDocAtom);
  const setOriginalDoc = useSetAtom(originalDocAtom);
  const setJsonState = useSetAtom(jsonStateAtom);
  const setSettingsText = useSetAtom(settingsTextAtom);
  const setSettingsParseError = useSetAtom(settingsParseErrorAtom);
  const setValidationState = useSetAtom(validationStateAtom);
  const setPreviewState = useSetAtom(previewStateAtom);
  const setIsSaving = useSetAtom(isSavingAtom);
  const setScopeEntries = useSetAtom(scopeEntriesAtom);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [activeSource, setActiveSource] = React.useState<ProfileDraftGuardSource | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const pendingContinuationRef = React.useRef<(() => void) | null>(null);
  const pendingSourceRef = React.useRef<ProfileDraftGuardSource | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const invalidDraftReason = settingsParseError
    ? "Fix the Settings JSON before saving."
    : jsonState.parseError
      ? "Fix the profile JSON before saving."
      : null;
  const layerCanSave = Boolean(
    hasUnsavedChanges && selectedScope && draftDoc && !invalidDraftReason
  );
  const layerSaveDisabledReason = layerCanSave ? null : invalidDraftReason;
  const snapshot = resolveProfileDraftGuardSnapshot({
    hasLayerChanges: hasUnsavedChanges,
    layerCanSave,
    layerSaveDisabledReason,
    basics: basicsGuard,
    preferredSource: open ? activeSource : null,
  });

  const completeWith = React.useCallback(
    (message: string) => {
      const continuation = pendingContinuationRef.current;
      pendingContinuationRef.current = null;
      pendingSourceRef.current = null;
      setActiveSource(null);
      setOpen(false);
      setErrorMessage(null);
      announce(message);
      window.setTimeout(() => {
        continuation?.();
      }, 0);
    },
    [announce]
  );

  const resetDraftToOriginal = React.useCallback(() => {
    const nextDoc = originalDoc ? cloneDoc(originalDoc) : null;
    setDraftDoc(nextDoc);
    setJsonState({ text: nextDoc ? stringifyDoc(nextDoc) : "", parseError: null });
    setSettingsText(stringifyValue(nextDoc?.settings ?? {}));
    setSettingsParseError(null);
    setValidationState({ status: "idle", issues: [], errorMessage: null });
    setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
  }, [
    originalDoc,
    setDraftDoc,
    setJsonState,
    setPreviewState,
    setSettingsParseError,
    setSettingsText,
    setValidationState,
  ]);

  const request = React.useCallback(
    (continuation: () => void, requestOptions?: ProfileDraftGuardRequestOptions) => {
      const nextSnapshot = resolveProfileDraftGuardSnapshot({
        hasLayerChanges: hasUnsavedChanges,
        layerCanSave,
        layerSaveDisabledReason,
        basics: basicsGuard,
      });
      if (!nextSnapshot.source || !nextSnapshot.hasChanges) {
        continuation();
        return;
      }
      pendingContinuationRef.current = continuation;
      pendingSourceRef.current = nextSnapshot.source;
      returnFocusRef.current = requestOptions?.returnFocusTo ?? null;
      setActiveSource(nextSnapshot.source);
      setErrorMessage(null);
      setOpen(true);
      announce("Unsaved profile changes need a decision before leaving.");
    },
    [announce, basicsGuard, hasUnsavedChanges, layerCanSave, layerSaveDisabledReason]
  );

  const cancel = React.useCallback(() => {
    const source = pendingSourceRef.current ?? activeSource;
    pendingContinuationRef.current = null;
    pendingSourceRef.current = null;
    setActiveSource(null);
    setOpen(false);
    setErrorMessage(null);
    announce(getDialogCopy(source).cancelAnnouncement);
    window.setTimeout(() => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }, 0);
  }, [activeSource, announce]);

  const discardAndContinue = React.useCallback(() => {
    const source = pendingSourceRef.current ?? activeSource;
    if (source === "basics") {
      basicsGuard?.discardAndClose();
      completeWith(BASICS_DIALOG_COPY.discardAnnouncement);
      return;
    }
    resetDraftToOriginal();
    completeWith(LAYER_DIALOG_COPY.discardAnnouncement);
  }, [activeSource, basicsGuard, completeWith, resetDraftToOriginal]);

  const saveLayerAndContinue = React.useCallback(async () => {
    if (!selectedScope || !draftDoc || !layerCanSave) {
      setErrorMessage(layerSaveDisabledReason ?? "This draft cannot be saved yet.");
      return;
    }
    const bridge = window.myclaude;
    if (!bridge?.profile?.save) {
      setErrorMessage("Renderer bridge is incomplete. Waiting for profile.save.");
      return;
    }

    setBusy(true);
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const savedDoc = cloneDoc(draftDoc);
      await bridge.profile.save({ path: selectedScope.path, content: savedDoc });
      setOriginalDoc(cloneDoc(savedDoc));
      setDraftDoc(cloneDoc(savedDoc));
      setJsonState({ text: stringifyDoc(savedDoc), parseError: null });
      setSettingsText(stringifyValue(savedDoc.settings ?? {}));
      setSettingsParseError(null);
      setValidationState({ status: "idle", issues: [], errorMessage: null });
      setPreviewState({ status: "idle", effective: null, diff: [], errorMessage: null });
      setScopeEntries((entries) =>
        entries.map((entry) =>
          entry.path === selectedScope.path ? { ...entry, content: cloneDoc(savedDoc) } : entry
        )
      );
      completeWith(LAYER_DIALOG_COPY.saveAnnouncement);
    } catch (error) {
      const message = formatProfileDraftGuardError(error, "layers");
      setErrorMessage(message);
      announce(`${LAYER_DIALOG_COPY.saveFailurePrefix}: ${message}`);
    } finally {
      setBusy(false);
      setIsSaving(false);
    }
  }, [
    announce,
    completeWith,
    draftDoc,
    layerCanSave,
    layerSaveDisabledReason,
    selectedScope,
    setDraftDoc,
    setIsSaving,
    setJsonState,
    setOriginalDoc,
    setPreviewState,
    setScopeEntries,
    setSettingsParseError,
    setSettingsText,
    setValidationState,
  ]);

  const saveBasicsAndContinue = React.useCallback(async () => {
    if (!basicsGuard?.canSave) {
      setErrorMessage(basicsGuard?.saveDisabledReason ?? "Profile Basics cannot be saved yet.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      await basicsGuard.saveAndClose();
      completeWith(BASICS_DIALOG_COPY.saveAnnouncement);
    } catch (error) {
      const message = formatProfileDraftGuardError(error, "basics");
      setErrorMessage(message);
      announce(`${BASICS_DIALOG_COPY.saveFailurePrefix}: ${message}`);
    } finally {
      setBusy(false);
    }
  }, [announce, basicsGuard, completeWith]);

  const saveAndContinue = React.useCallback(async () => {
    const source = pendingSourceRef.current ?? activeSource;
    if (source === "basics") {
      await saveBasicsAndContinue();
      return;
    }
    await saveLayerAndContinue();
  }, [activeSource, saveBasicsAndContinue, saveLayerAndContinue]);

  return {
    open,
    busy: busy || (snapshot.source === "basics" && Boolean(basicsGuard?.isSaving)),
    errorMessage,
    canSave: snapshot.canSave,
    saveDisabledReason: snapshot.saveDisabledReason,
    title: snapshot.title,
    description: snapshot.description,
    request,
    cancel,
    discardAndContinue,
    saveAndContinue,
  };
}

function getDialogCopy(source: ProfileDraftGuardSource | null): typeof LAYER_DIALOG_COPY {
  if (source === "basics") return BASICS_DIALOG_COPY;
  if (source === "layers") return LAYER_DIALOG_COPY;
  return DEFAULT_DIALOG_COPY;
}

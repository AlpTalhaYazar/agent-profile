import { useAtomValue, useSetAtom } from "jotai";
import * as React from "react";
import {
  draftDocAtom,
  hasUnsavedChangesAtom,
  isSavingAtom,
  jsonStateAtom,
  originalDocAtom,
  previewStateAtom,
  scopeEntriesAtom,
  selectedScopeAtom,
  settingsParseErrorAtom,
  settingsTextAtom,
  validationStateAtom,
} from "./atoms.js";
import { cloneDoc, stringifyDoc, stringifyValue } from "./clone.js";
import { getErrorMessage } from "./normalize.js";

export interface ProfileDraftNavigationGuard {
  open: boolean;
  busy: boolean;
  errorMessage: string | null;
  canSave: boolean;
  saveDisabledReason: string | null;
  request: (continuation: () => void, options?: ProfileDraftGuardRequestOptions) => void;
  cancel: () => void;
  discardAndContinue: () => void;
  saveAndContinue: () => Promise<void>;
}

export interface ProfileDraftGuardRequestOptions {
  returnFocusTo?: HTMLElement | null | undefined;
}

export function useProfileDraftNavigationGuard(options: {
  announce: (message: string) => void;
}): ProfileDraftNavigationGuard {
  const { announce } = options;
  const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom);
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
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const pendingContinuationRef = React.useRef<(() => void) | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const invalidDraftReason = settingsParseError
    ? "Fix the Settings JSON before saving."
    : jsonState.parseError
      ? "Fix the profile JSON before saving."
      : null;
  const canSave = Boolean(hasUnsavedChanges && selectedScope && draftDoc && !invalidDraftReason);
  const saveDisabledReason = canSave ? null : invalidDraftReason;

  const completeWith = React.useCallback(
    (message: string) => {
      const continuation = pendingContinuationRef.current;
      pendingContinuationRef.current = null;
      setOpen(false);
      setErrorMessage(null);
      announce(message);
      continuation?.();
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
      if (!hasUnsavedChanges) {
        continuation();
        return;
      }
      pendingContinuationRef.current = continuation;
      returnFocusRef.current = requestOptions?.returnFocusTo ?? null;
      setErrorMessage(null);
      setOpen(true);
      announce("Unsaved profile changes need a decision before leaving.");
    },
    [announce, hasUnsavedChanges]
  );

  const cancel = React.useCallback(() => {
    pendingContinuationRef.current = null;
    setOpen(false);
    setErrorMessage(null);
    announce("Stayed on the current profile draft.");
    window.setTimeout(() => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }, 0);
  }, [announce]);

  const discardAndContinue = React.useCallback(() => {
    resetDraftToOriginal();
    completeWith("Discarded profile changes.");
  }, [completeWith, resetDraftToOriginal]);

  const saveAndContinue = React.useCallback(async () => {
    if (!selectedScope || !draftDoc || !canSave) {
      setErrorMessage(saveDisabledReason ?? "This draft cannot be saved yet.");
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
      completeWith("Saved profile changes.");
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      announce(`Save failed: ${message}`);
    } finally {
      setBusy(false);
      setIsSaving(false);
    }
  }, [
    announce,
    canSave,
    completeWith,
    draftDoc,
    saveDisabledReason,
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

  return {
    open,
    busy,
    errorMessage,
    canSave,
    saveDisabledReason,
    request,
    cancel,
    discardAndContinue,
    saveAndContinue,
  };
}

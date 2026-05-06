import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-profile/ui";
import type * as React from "react";
import type { ProfileDraftNavigationGuard } from "../lib/profile-draft-guard.js";

export function ProfileUnsavedChangesDialog({
  guard,
}: {
  guard: ProfileDraftNavigationGuard;
}): React.ReactElement {
  return (
    <Dialog open={guard.open} onOpenChange={(open) => (open ? undefined : guard.cancel())}>
      <DialogContent data-testid="profile-unsaved-dialog">
        <DialogHeader>
          <DialogTitle>Save profile changes?</DialogTitle>
          <DialogDescription>
            This profile has unsaved layer changes. Save before leaving, discard the draft, or stay
            here to keep editing.
          </DialogDescription>
        </DialogHeader>
        {guard.saveDisabledReason ? (
          <p
            className="rounded-md border border-status-warning bg-status-warning-soft px-3 py-2 text-sm text-status-warning"
            data-testid="profile-unsaved-save-disabled-reason"
          >
            {guard.saveDisabledReason}
          </p>
        ) : null}
        {guard.errorMessage ? (
          <p
            className="rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger"
            data-testid="profile-unsaved-error"
          >
            {guard.errorMessage}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            data-testid="profile-unsaved-cancel"
            disabled={guard.busy}
            onClick={guard.cancel}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            data-testid="profile-unsaved-discard"
            disabled={guard.busy}
            onClick={guard.discardAndContinue}
            type="button"
            variant="secondary"
          >
            Discard
          </Button>
          <Button
            data-testid="profile-unsaved-save"
            disabled={!guard.canSave || guard.busy}
            onClick={() => void guard.saveAndContinue()}
            type="button"
            variant="primary"
          >
            {guard.busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import type * as React from "react";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export interface ConfirmDialogProps {
  /** Controlled open state. */
  open: boolean;
  /** Notified when the user closes the dialog (Escape, overlay click, Cancel). */
  onOpenChange: (open: boolean) => void;
  /** Title shown at the top of the dialog. */
  title: string;
  /** Optional descriptive paragraph under the title. */
  description?: React.ReactNode;
  /** Label of the confirm action. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label of the cancel action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Called when the user clicks the confirm button. */
  onConfirm: () => void | Promise<void>;
  /** When true, the confirm button uses the danger tone (red). */
  destructive?: boolean;
  /** When true, the confirm button is disabled (e.g. while the action runs). */
  busy?: boolean;
}

/**
 * Modal yes/no confirmation around a destructive or otherwise irreversible
 * action. The caller wires `open` + `onOpenChange` to local state; this
 * component does not own its visibility.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  destructive = false,
  busy = false,
}: ConfirmDialogProps): React.ReactElement {
  const handleConfirm = async (): Promise<void> => {
    await onConfirm();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-profile/ui";
import { Keyboard } from "lucide-react";
import type * as React from "react";
import { IconFrame } from "./screen-ui.js";

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  ["Global", "Cmd/Ctrl K", "Open command palette"],
  ["Global", "Cmd/Ctrl 1-4", "Switch screens"],
  ["Global", "?", "Open keyboard shortcuts"],
  ["Global", "Escape", "Close dialogs and overlays"],
  ["Tree", "Up / Down", "Move between scope entries"],
  ["Tree", "Enter", "Select focused entry"],
  ["Tables", "Up / Down", "Move between rows"],
  ["Tables", "Enter", "Select focused row"],
  ["Palette", "Up / Down", "Move through results"],
  ["Palette", "Enter", "Run selected command"],
] as const;

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="shortcuts-help">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IconFrame icon={Keyboard} size="sm" />
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </div>
          <DialogDescription>Common navigation and editor commands.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {SHORTCUTS.map(([group, shortcut, description]) => (
            <div
              className="grid grid-cols-[7rem_8rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-default bg-subtle px-3 py-2 text-sm"
              key={`${group}:${shortcut}`}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-tertiary">
                {group}
              </span>
              <kbd className="rounded border border-default bg-surface px-2 py-1 font-mono text-xs text-primary">
                {shortcut}
              </kbd>
              <span className="text-secondary">{description}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

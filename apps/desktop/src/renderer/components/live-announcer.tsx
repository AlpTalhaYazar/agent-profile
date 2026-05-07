import { useAtomValue, useSetAtom } from "jotai";
import * as React from "react";
import { announceMessageAtom } from "../lib/atoms.js";

export function LiveAnnouncer(): React.ReactElement {
  const message = useAtomValue(announceMessageAtom);
  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className="sr-only"
      data-testid="app-live-announcer"
    >
      {message}
    </output>
  );
}

export function useAnnounce(): (message: string) => void {
  const setMessage = useSetAtom(announceMessageAtom);
  const lastMessageRef = React.useRef("");

  return React.useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      if (trimmed === lastMessageRef.current) {
        setMessage("");
        window.setTimeout(() => setMessage(trimmed), 20);
        return;
      }
      lastMessageRef.current = trimmed;
      setMessage(trimmed);
    },
    [setMessage],
  );
}

import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@agent-profile/ui";
import { SquareTerminal, X } from "lucide-react";
import * as React from "react";
import type { SessionTerminalEvent } from "../../shared/bridge.js";
import { IconFrame } from "./screen-ui.js";

export function SessionTerminal({
  initialBuffer,
  onClose,
  sessionId,
}: {
  initialBuffer?: string;
  onClose: () => void;
  sessionId: string;
}): React.ReactElement {
  const terminalRef = React.useRef<Terminal | null>(null);
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<"attached" | "exited">("attached");

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const terminal = new Terminal({
      cols: 120,
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      rows: 28,
      theme: {
        background: "#05080d",
        foreground: "#d7dee8",
      },
    });
    terminalRef.current = terminal;
    terminal.open(mount);
    if (initialBuffer) terminal.write(initialBuffer);

    const dataDisposable = terminal.onData((data) => {
      void window.myclaude?.sessions?.writeTerminal({ sessionId, data });
    });

    const disposeTerminalEvent = window.myclaude?.sessions?.onTerminalEvent?.(
      (event: SessionTerminalEvent) => {
        if (event.sessionId !== sessionId) return;
        if (event.kind === "data") {
          terminal.write(event.data);
        } else if (event.kind === "exit") {
          setStatus("exited");
          terminal.writeln(`\r\n[session exited with code ${event.exitCode}]`);
        } else if (event.kind === "error") {
          terminal.writeln(`\r\n[terminal error: ${event.message}]`);
        }
      }
    );

    void window.myclaude?.sessions?.resizeTerminal({ sessionId, cols: 120, rows: 28 });

    return () => {
      dataDisposable.dispose();
      disposeTerminalEvent?.();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [initialBuffer, sessionId]);

  return (
    <section className="overflow-hidden rounded-md border border-default bg-surface">
      <header className="flex items-center justify-between border-b border-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconFrame icon={SquareTerminal} size="sm" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-primary">Terminal</h2>
            <p className="truncate font-mono text-xs text-secondary">{sessionId}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-default bg-subtle px-2 py-1 text-xs text-secondary">
            {status}
          </span>
          <Button onClick={onClose} size="sm" type="button" variant="secondary">
            <X className="h-4 w-4" aria-hidden="true" />
            Close terminal
          </Button>
        </div>
      </header>
      <div className="h-[28rem] bg-canvas p-3">
        <div
          className="h-full overflow-hidden rounded-md border border-subtle bg-black"
          ref={mountRef}
        />
      </div>
    </section>
  );
}

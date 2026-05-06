/**
 * @module renderer/screens/session-monitor
 *
 * Phase 2 milestone 5 Session Monitor screen.
 *
 * Live updates ride the Main-forwarded `myclaude.sessions.event` channel via
 * `window.myclaude.sessions.onUpdate`. When the daemon connection drops we
 * receive a `connection: down` notice and switch to a 5-second polling
 * fallback; on `connection: up` we re-snapshot once and clear the interval.
 *
 * Kill / Relaunch are both gated behind a ConfirmDialog. Drift refresh is a
 * read-only on-demand action.
 */

import {
  Badge,
  Button,
  ConfirmDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@agent-profile/ui";
import { useAtom, useAtomValue } from "jotai";
import {
  Activity,
  Clipboard,
  GitCompare,
  History,
  MonitorPlay,
  Play,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import * as React from "react";
import type { SessionUpdatePayload } from "../../shared/bridge.js";
import { useAnnounce } from "../components/live-announcer.js";
import {
  EmptyState,
  IconFrame,
  InfoPanel,
  ScreenHeader,
  ScreenSurface,
} from "../components/screen-ui.js";
import { SessionTerminal } from "../components/session-terminal.js";
import {
  activeTerminalSessionIdAtom,
  cwdAtom,
  selectedAuthIdAtom,
  selectedRoleAtom,
} from "../lib/atoms.js";
import { useRovingTabIndex } from "../lib/use-roving-tab-index.js";

interface SessionView {
  source: "profile" | "claude-native";
  sessionId: string;
  title?: string;
  role?: string;
  authProfileId?: string;
  cwd: string;
  status: "running" | "exited" | "failed" | "dry-run" | "history";
  createdAt: string;
  updatedAt: string;
  attachable: boolean;
  resumable: boolean;
  exitCode?: number;
  liveCapability?: boolean;
  capabilityExpiresAtMs?: number;
  processAlive?: boolean;
  relaunchedFrom?: string;
  spawnCommand?: string;
}

interface DriftView {
  drifted: boolean;
  scopesChanged: string[];
  oldHash: string;
  newHash: string;
}

function normalizeSessions(input: unknown): SessionView[] {
  if (input === null || typeof input !== "object") return [];
  const sessions = (input as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) return [];
  return sessions
    .map((entry): SessionView | null => {
      if (entry === null || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const sessionId = typeof e.sessionId === "string" ? e.sessionId : null;
      if (!sessionId) return null;
      const source = e.source === "claude-native" ? "claude-native" : "profile";
      const status =
        e.status === "running" || e.status === "exited" || e.status === "failed"
          ? e.status
          : e.status === "history"
            ? e.status
            : ("dry-run" as const);
      const spawn = e.spawn as Record<string, unknown> | undefined;
      const view: SessionView = {
        source,
        sessionId,
        cwd: typeof e.cwd === "string" ? e.cwd : "",
        status,
        createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
        updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : "",
        attachable: e.attachable === true,
        resumable: e.resumable === true,
      };
      if (typeof e.role === "string") view.role = e.role;
      if (typeof e.authProfileId === "string") view.authProfileId = e.authProfileId;
      if (typeof e.title === "string") view.title = e.title;
      if (typeof e.exitCode === "number") view.exitCode = e.exitCode;
      if (typeof e.liveCapability === "boolean") view.liveCapability = e.liveCapability;
      if (typeof e.capabilityExpiresAtMs === "number")
        view.capabilityExpiresAtMs = e.capabilityExpiresAtMs;
      if (typeof e.processAlive === "boolean") view.processAlive = e.processAlive;
      if (typeof e.relaunchedFrom === "string") view.relaunchedFrom = e.relaunchedFrom;
      if (spawn && typeof spawn.command === "string") {
        const args = Array.isArray(spawn.args)
          ? spawn.args.filter((a): a is string => typeof a === "string")
          : [];
        view.spawnCommand = [spawn.command, ...args].join(" ");
      }
      return view;
    })
    .filter((s): s is SessionView => s !== null);
}

function statusBadge(view: SessionView): React.ReactElement {
  if (view.status === "history") {
    return <Badge tone="info">history</Badge>;
  }
  if (view.status === "running") {
    if (view.liveCapability && view.processAlive !== false) {
      return <Badge tone="success">running</Badge>;
    }
    return <Badge tone="warning">running (stale)</Badge>;
  }
  if (view.status === "exited") {
    const exitCode = view.exitCode !== undefined ? `exit ${view.exitCode}` : "exited";
    return <Badge tone="neutral">{exitCode}</Badge>;
  }
  if (view.status === "failed") {
    return <Badge tone="danger">failed</Badge>;
  }
  return <Badge tone="info">dry-run</Badge>;
}

function sourceBadge(view: SessionView): React.ReactElement {
  return view.source === "claude-native" ? (
    <Badge tone="info">Claude</Badge>
  ) : (
    <Badge tone="neutral">Profile</Badge>
  );
}

function sessionKey(view: Pick<SessionView, "source" | "sessionId">): string {
  return `${view.source}:${view.sessionId}`;
}

function fmtTimeAgo(iso: string): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function terminalState(
  sessionId: string,
  buffer: string | undefined
): { sessionId: string; buffer?: string } {
  const state: { sessionId: string; buffer?: string } = { sessionId };
  if (buffer !== undefined) state.buffer = buffer;
  return state;
}

export function SessionMonitorScreen(): React.ReactElement {
  const [sessions, setSessions] = React.useState<SessionView[]>([]);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [drift, setDrift] = React.useState<Record<string, DriftView>>({});
  const [connection, setConnection] = React.useState<"up" | "down" | "polling">("up");
  const [killTarget, setKillTarget] = React.useState<string | null>(null);
  const [runAgainTarget, setRunAgainTarget] = React.useState<string | null>(null);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useAtom(
    activeTerminalSessionIdAtom
  );
  const cwd = useAtomValue(cwdAtom);
  const selectedRole = useAtomValue(selectedRoleAtom);
  const selectedAuthId = useAtomValue(selectedAuthIdAtom);
  const [terminal, setTerminal] = React.useState<{ sessionId: string; buffer?: string } | null>(
    null
  );
  const announce = useAnnounce();

  const reload = React.useCallback(async (): Promise<void> => {
    const bridge = window.myclaude?.sessions;
    if (!bridge) {
      setError("Bridge unavailable");
      setLoading(false);
      return;
    }
    try {
      const list = await bridge.list({ cwd, includeNative: true });
      const next = normalizeSessions(list);
      setSessions(next);
      setSelectedKey((current) => {
        if (current && next.some((session) => sessionKey(session) === current)) return current;
        return next[0] ? sessionKey(next[0]) : null;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // Subscribe to push events + maintain a polling fallback when the daemon
  // connection drops.
  React.useEffect(() => {
    void reload();
    const bridge = window.myclaude?.sessions;
    if (!bridge?.onUpdate) return;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPolling = (): void => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void reload();
      }, 5_000);
    };
    const stopPolling = (): void => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const dispose = bridge.onUpdate((payload: SessionUpdatePayload) => {
      if (payload.kind === "connection") {
        if (payload.state === "down") {
          setConnection("polling");
          announce("Session monitor reconnecting");
          startPolling();
        } else if (payload.state === "up") {
          setConnection("up");
          announce("Session monitor connected");
          stopPolling();
          void reload();
        }
        return;
      }
      if (payload.kind === "event" && payload.event) {
        // Lightweight live update: refresh on every event so derived fields
        // (status, capability, drift) stay coherent without re-implementing
        // the daemon's enrichment logic on the client.
        announce(`Session ${payload.event.sessionId} ${payload.event.event}`);
        void reload();
      }
    });
    return () => {
      stopPolling();
      dispose();
    };
  }, [announce, reload]);

  React.useEffect(() => {
    if (!activeTerminalSessionId || terminal?.sessionId === activeTerminalSessionId) return;
    void handleOpenTerminal(activeTerminalSessionId);
  }, [activeTerminalSessionId, terminal?.sessionId]);

  const selected = sessions.find((s) => sessionKey(s) === selectedKey) ?? null;
  const driftFor = selected?.source === "profile" ? drift[selected.sessionId] : undefined;
  const { getItemProps: getSessionRowProps } = useRovingTabIndex<HTMLTableRowElement>({
    count: sessions.length,
    orientation: "vertical",
    onActivate: (index) => {
      const session = sessions[index];
      if (session) setSelectedKey(sessionKey(session));
    },
  });

  const handleDrift = async (sessionId: string): Promise<void> => {
    setBusy(true);
    try {
      const result = (await window.myclaude?.sessions?.drift({ sessionId })) as
        | DriftView
        | undefined;
      if (result) {
        setDrift((prev) => ({ ...prev, [sessionId]: result }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleKill = async (sessionId: string): Promise<void> => {
    setBusy(true);
    try {
      await window.myclaude?.sessions?.kill({ sessionId });
      await reload();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRunAgain = async (targetKey: string): Promise<void> => {
    const source = sessions.find((session) => sessionKey(session) === targetKey);
    if (!source) return;
    const role = source.source === "profile" ? source.role : selectedRole;
    const authProfileId = source.source === "profile" ? source.authProfileId : selectedAuthId;
    const launchCwd = source.cwd || cwd;
    if (!role || !authProfileId || !launchCwd) {
      setError("This session record is missing role, Claude credential, or working directory.");
      return;
    }
    setBusy(true);
    try {
      const result = (await window.myclaude?.sessions?.launch({
        role,
        authProfileId,
        cwd: launchCwd,
      })) as { sessionId?: string } | undefined;
      await reload();
      if (typeof result?.sessionId === "string") {
        setActiveTerminalSessionId(result.sessionId);
        const opened = await window.myclaude?.sessions?.openTerminal({
          sessionId: result.sessionId,
        });
        if (opened?.attached) {
          setTerminal(terminalState(result.sessionId, opened.buffer));
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResumeNative = async (session: SessionView): Promise<void> => {
    const resumeCwd = session.cwd || cwd;
    if (!resumeCwd) {
      setError("This Claude session is missing its working directory.");
      return;
    }
    setBusy(true);
    try {
      const result = await window.myclaude?.sessions?.resumeNative({
        sessionId: session.sessionId,
        cwd: resumeCwd,
      });
      if (typeof result?.sessionId === "string") {
        setActiveTerminalSessionId(result.sessionId);
        const opened = await window.myclaude?.sessions?.openTerminal({
          sessionId: result.sessionId,
        });
        if (opened?.attached) {
          setTerminal(terminalState(result.sessionId, opened.buffer));
        }
      }
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenTerminal = async (sessionId: string): Promise<void> => {
    setBusy(true);
    try {
      const opened = await window.myclaude?.sessions?.openTerminal({ sessionId });
      if (!opened?.attached) {
        setError(opened?.reason ?? "This session cannot be attached. Use Run again.");
        return;
      }
      setActiveTerminalSessionId(sessionId);
      setTerminal(terminalState(sessionId, opened.buffer));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCloseTerminal = async (sessionId: string): Promise<void> => {
    setTerminal(null);
    await window.myclaude?.sessions?.closeTerminal({ sessionId }).catch(() => undefined);
  };

  return (
    <ScreenSurface aria-busy={loading || busy}>
      <ScreenHeader
        actions={
          <Button disabled={busy} onClick={() => void reload()} type="button" variant="secondary">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        }
        description={`${connection === "up" ? "Live push events" : "Polling reconnect"} · ${
          sessions.length
        } record${sessions.length === 1 ? "" : "s"} · ${cwd || "No workspace selected"}`}
        status={connection === "up" ? "Connected" : "Reconnecting"}
        title="Sessions"
      />

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-6 window-large:grid-cols-[minmax(0,1fr)_380px]">
        <section className="app-scrollbar min-h-0 min-w-0 overflow-auto rounded-md border border-default bg-surface">
          {loading ? (
            <p className="px-4 py-6 text-sm text-secondary">Loading…</p>
          ) : sessions.length === 0 ? (
            <EmptyState icon={MonitorPlay} title="No workspace sessions">
              No Claude history or Agent Profile sessions were found for this workspace.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => {
                  const key = sessionKey(s);
                  const active = key === selectedKey;
                  return (
                    <TableRow
                      aria-label={`Select session ${s.title || s.sessionId}`}
                      aria-selected={active}
                      className="h-12 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-state={active ? "selected" : undefined}
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      {...getSessionRowProps(sessions.indexOf(s))}
                    >
                      <TableCell className="min-w-0">
                        <div className="truncate text-sm text-primary">
                          {s.title || s.sessionId}
                        </div>
                        <div className="truncate font-mono text-xs text-secondary">
                          {s.sessionId}
                        </div>
                      </TableCell>
                      <TableCell>{sourceBadge(s)}</TableCell>
                      <TableCell>
                        {s.source === "profile" ? (
                          <div className="min-w-0">
                            <div className="truncate text-sm">{s.role || "—"}</div>
                            <div className="truncate text-xs text-secondary">
                              {s.authProfileId || "—"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-secondary">Native</span>
                        )}
                      </TableCell>
                      <TableCell>{fmtTimeAgo(s.createdAt)}</TableCell>
                      <TableCell>{statusBadge(s)}</TableCell>
                      <TableCell className="min-w-[180px]">
                        <div className="flex flex-wrap gap-2">
                          {s.source === "claude-native" ? (
                            <>
                              <Button
                                disabled={busy}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  void handleResumeNative(s);
                                }}
                                size="sm"
                                type="button"
                                variant="primary"
                              >
                                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                Resume
                              </Button>
                              <Button
                                disabled={busy}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setRunAgainTarget(key);
                                }}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                <Play className="h-4 w-4" aria-hidden="true" />
                                Run with current profile
                              </Button>
                            </>
                          ) : s.attachable || s.sessionId === activeTerminalSessionId ? (
                            <Button
                              disabled={busy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void handleOpenTerminal(s.sessionId);
                              }}
                              size="sm"
                              type="button"
                              variant="primary"
                            >
                              <SquareTerminal className="h-4 w-4" aria-hidden="true" />
                              Open terminal
                            </Button>
                          ) : (
                            <Button
                              disabled={busy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setRunAgainTarget(key);
                              }}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              <Play className="h-4 w-4" aria-hidden="true" />
                              Run again
                            </Button>
                          )}
                          {s.source === "profile" &&
                          s.status === "running" &&
                          s.processAlive === true ? (
                            <Button
                              disabled={busy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setKillTarget(s.sessionId);
                              }}
                              size="sm"
                              type="button"
                              variant="danger"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Kill
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {error ? (
            <div className="m-4 rounded-md border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-status-danger">
              {error}
            </div>
          ) : null}
        </section>

        <InfoPanel className="min-w-0" icon={Activity} title="Session detail">
          {selected === null ? (
            <div className="py-10">
              <EmptyState icon={MonitorPlay} title="Select a session">
                Session actions and runtime metadata appear here.
              </EmptyState>
            </div>
          ) : (
            <div className="grid min-w-0 gap-4">
              <div className="flex items-start gap-3">
                <IconFrame icon={selected.source === "claude-native" ? History : MonitorPlay} />
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-primary">
                    {selected.sessionId}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-secondary">
                    {sourceBadge(selected)}
                    <span>
                      {selected.source === "profile"
                        ? `${selected.role || "—"} · ${selected.authProfileId || "—"}`
                        : selected.title || "Native Claude history"}
                    </span>
                  </div>
                </div>
              </div>
              <dl className="grid gap-3 text-sm">
                <DetailRow label="Dir" value={selected.cwd} />
                <DetailRow
                  label="Source"
                  value={selected.source === "profile" ? "Profile" : "Claude"}
                />
                {selected.spawnCommand !== undefined ? (
                  <DetailRow label="Command" value={selected.spawnCommand} />
                ) : null}
                {selected.relaunchedFrom !== undefined ? (
                  <DetailRow label="Relaunched from" value={selected.relaunchedFrom} />
                ) : null}
                {selected.source === "profile" ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-secondary">Drift</dt>
                    <dd className="text-right">
                      {driftFor === undefined ? (
                        <span className="text-secondary">not checked</span>
                      ) : driftFor.drifted ? (
                        <span className="text-status-warning">
                          drifted ({driftFor.scopesChanged.length} scope
                          {driftFor.scopesChanged.length === 1 ? "" : "s"})
                        </span>
                      ) : (
                        <span className="text-status-success">in sync</span>
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex flex-wrap gap-2">
                {selected.source === "claude-native" ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => void handleResumeNative(selected)}
                      size="sm"
                      type="button"
                      variant="primary"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Resume
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => setRunAgainTarget(sessionKey(selected))}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      Run with current profile
                    </Button>
                  </>
                ) : selected.attachable || selected.sessionId === activeTerminalSessionId ? (
                  <Button
                    disabled={busy}
                    onClick={() => void handleOpenTerminal(selected.sessionId)}
                    size="sm"
                    type="button"
                    variant="primary"
                  >
                    <SquareTerminal className="h-4 w-4" aria-hidden="true" />
                    Open terminal
                  </Button>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => setRunAgainTarget(sessionKey(selected))}
                    size="sm"
                    type="button"
                    variant="primary"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    Run again
                  </Button>
                )}
                {selected.source === "profile" ? (
                  <Button
                    disabled={busy}
                    onClick={() => void handleDrift(selected.sessionId)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <GitCompare className="h-4 w-4" aria-hidden="true" />
                    Check drift
                  </Button>
                ) : null}
                {selected.spawnCommand !== undefined ? (
                  <Button
                    onClick={() => {
                      void navigator.clipboard?.writeText(selected.spawnCommand ?? "");
                      announce("Session command copied");
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Clipboard className="h-4 w-4" aria-hidden="true" />
                    Copy command
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </InfoPanel>
      </div>

      {terminal ? (
        <div className="border-t border-subtle bg-subtle p-4">
          <SessionTerminal
            {...(terminal.buffer !== undefined ? { initialBuffer: terminal.buffer } : {})}
            onClose={() => void handleCloseTerminal(terminal.sessionId)}
            sessionId={terminal.sessionId}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={killTarget !== null}
        onOpenChange={(open) => {
          if (!open) setKillTarget(null);
        }}
        title={killTarget ? `Kill session "${killTarget}"?` : "Kill session"}
        description="Sends SIGTERM to the live process and revokes its capability."
        destructive
        confirmLabel="Kill"
        busy={busy}
        onConfirm={async () => {
          if (killTarget !== null) {
            await handleKill(killTarget);
            setKillTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={runAgainTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRunAgainTarget(null);
        }}
        title={runAgainTarget ? "Run with profile?" : "Run session again"}
        description="Starts a new GUI-owned terminal session with the selected role, Claude credential, and working directory."
        confirmLabel="Run again"
        busy={busy}
        onConfirm={async () => {
          if (runAgainTarget !== null) {
            await handleRunAgain(runAgainTarget);
            setRunAgainTarget(null);
          }
        }}
      />
    </ScreenSurface>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-xs text-primary">{value || "—"}</dd>
    </div>
  );
}

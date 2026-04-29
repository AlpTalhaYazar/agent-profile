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
import * as React from "react";

interface SessionView {
  sessionId: string;
  role: string;
  authProfileId: string;
  cwd: string;
  status: "running" | "exited" | "failed" | "dry-run";
  createdAt: string;
  updatedAt: string;
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

interface SessionEventPayload {
  sessionId: string;
  event: "started" | "idle" | "exited" | "killed" | "drifted";
  exitCode?: number;
  ts: number;
}

interface SessionUpdatePayload {
  kind: "event" | "connection";
  event?: SessionEventPayload;
  state?: "up" | "down";
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
      const status =
        e.status === "running" || e.status === "exited" || e.status === "failed"
          ? e.status
          : ("dry-run" as const);
      const spawn = e.spawn as Record<string, unknown> | undefined;
      const view: SessionView = {
        sessionId,
        role: typeof e.role === "string" ? e.role : "",
        authProfileId: typeof e.authProfileId === "string" ? e.authProfileId : "",
        cwd: typeof e.cwd === "string" ? e.cwd : "",
        status,
        createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
        updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : "",
      };
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

export function SessionMonitorScreen(): React.ReactElement {
  const [sessions, setSessions] = React.useState<SessionView[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [drift, setDrift] = React.useState<Record<string, DriftView>>({});
  const [connection, setConnection] = React.useState<"up" | "down" | "polling">("up");
  const [killTarget, setKillTarget] = React.useState<string | null>(null);
  const [relaunchTarget, setRelaunchTarget] = React.useState<string | null>(null);

  const reload = React.useCallback(async (): Promise<void> => {
    const bridge = window.myclaude?.sessions;
    if (!bridge) {
      setError("Bridge unavailable");
      setLoading(false);
      return;
    }
    try {
      const list = await bridge.list();
      const next = normalizeSessions(list);
      setSessions(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

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
          startPolling();
        } else if (payload.state === "up") {
          setConnection("up");
          stopPolling();
          void reload();
        }
        return;
      }
      if (payload.kind === "event" && payload.event) {
        // Lightweight live update: refresh on every event so derived fields
        // (status, capability, drift) stay coherent without re-implementing
        // the daemon's enrichment logic on the client.
        void reload();
      }
    });
    return () => {
      stopPolling();
      dispose();
    };
  }, [reload]);

  const selected = sessions.find((s) => s.sessionId === selectedId) ?? null;
  const driftFor = selectedId !== null ? drift[selectedId] : undefined;

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

  const handleRelaunch = async (sessionId: string): Promise<void> => {
    setBusy(true);
    try {
      const result = (await window.myclaude?.sessions?.relaunch({ sessionId })) as
        | { sessionId?: string }
        | undefined;
      await reload();
      if (typeof result?.sessionId === "string") {
        setSelectedId(result.sessionId);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto]">
      <section className="app-scrollbar min-h-0 overflow-auto bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Sessions</h2>
            <p className="text-sm text-neutral-500">
              {connection === "up" ? "Live (push events)" : "Reconnecting (polling)"} ·{" "}
              {sessions.length} record{sessions.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void reload()}
            disabled={busy}
          >
            Refresh
          </Button>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-neutral-500">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-500">No sessions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const active = s.sessionId === selectedId;
                return (
                  <TableRow
                    key={s.sessionId}
                    data-state={active ? "selected" : undefined}
                    onClick={() => setSelectedId(s.sessionId)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono text-xs">{s.sessionId}</TableCell>
                    <TableCell>{s.role}</TableCell>
                    <TableCell>{s.authProfileId}</TableCell>
                    <TableCell>{fmtTimeAgo(s.createdAt)}</TableCell>
                    <TableCell>{statusBadge(s)}</TableCell>
                    <TableCell>
                      {s.status === "running" ? (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setKillTarget(s.sessionId);
                          }}
                          disabled={busy}
                        >
                          Kill
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setRelaunchTarget(s.sessionId);
                          }}
                          disabled={busy}
                        >
                          Relaunch
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {error ? (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </section>

      <aside className="border-t border-neutral-200 bg-neutral-50 p-4">
        {selected === null ? (
          <p className="text-sm text-neutral-500">Select a session to see details.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="space-y-1 text-sm">
              <div className="font-mono text-xs">{selected.sessionId}</div>
              <div>
                <span className="text-neutral-500">Dir:</span>{" "}
                <span className="font-mono text-xs">{selected.cwd}</span>
              </div>
              {selected.spawnCommand !== undefined ? (
                <div>
                  <span className="text-neutral-500">Command:</span>{" "}
                  <span className="font-mono text-xs">{selected.spawnCommand}</span>
                </div>
              ) : null}
              {selected.relaunchedFrom !== undefined ? (
                <div>
                  <span className="text-neutral-500">Relaunched from:</span>{" "}
                  <span className="font-mono text-xs">{selected.relaunchedFrom}</span>
                </div>
              ) : null}
              <div>
                <span className="text-neutral-500">Drift:</span>{" "}
                {driftFor === undefined ? (
                  <span className="text-neutral-500">not checked</span>
                ) : driftFor.drifted ? (
                  <span className="text-amber-700">
                    drifted ({driftFor.scopesChanged.length} scope
                    {driftFor.scopesChanged.length === 1 ? "" : "s"} changed)
                  </span>
                ) : (
                  <span className="text-emerald-700">in sync</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleDrift(selected.sessionId)}
                disabled={busy}
              >
                Check drift
              </Button>
              {selected.spawnCommand !== undefined ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(selected.spawnCommand ?? "");
                  }}
                >
                  Copy command
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </aside>

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
        open={relaunchTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRelaunchTarget(null);
        }}
        title={relaunchTarget ? `Relaunch "${relaunchTarget}"?` : "Relaunch session"}
        description="Spawns a fresh session with the same role/auth/cwd. The original record is kept for history."
        confirmLabel="Relaunch"
        busy={busy}
        onConfirm={async () => {
          if (relaunchTarget !== null) {
            await handleRelaunch(relaunchTarget);
            setRelaunchTarget(null);
          }
        }}
      />
    </div>
  );
}

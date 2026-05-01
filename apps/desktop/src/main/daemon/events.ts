import type { DaemonClient, EvtSessionsEventT } from "@agent-profile/ipc-protocol";
import { BrowserWindow } from "electron";
import { SESSION_EVENT_CHANNEL } from "../../shared/channels.js";
import { connectDaemonClient } from "./client-runner.js";

export interface DaemonEventClient {
  client: DaemonClient | null;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  closed: boolean;
}

/**
 * Maintain a long-lived daemon subscription and forward session push events to
 * every BrowserWindow. A heartbeat request detects idle disconnects and feeds
 * the same reconnect path used for subscribe/connect failures.
 */
export async function startDaemonEventClient(
  myClaudeHome: string,
  clientVersion: string,
  opts: { heartbeatMs?: number; initialBackoffMs?: number; maxBackoffMs?: number } = {}
): Promise<DaemonEventClient> {
  const handle: DaemonEventClient = {
    client: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    closed: false,
  };

  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const initialBackoffMs = opts.initialBackoffMs ?? 1_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  let backoffMs = initialBackoffMs;

  const broadcastToRenderers = (payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(SESSION_EVENT_CHANNEL, payload);
    }
  };

  const clearHeartbeat = (): void => {
    if (!handle.heartbeatTimer) return;
    clearInterval(handle.heartbeatTimer);
    handle.heartbeatTimer = null;
  };

  const disconnect = (): void => {
    if (handle.closed) return;
    clearHeartbeat();
    if (handle.client) {
      handle.client.close();
      handle.client = null;
    }
    broadcastToRenderers({ kind: "connection", state: "down" });
    scheduleReconnect();
  };

  const connect = async (): Promise<void> => {
    if (handle.closed) return;
    try {
      const client = await connectDaemonClient(myClaudeHome, clientVersion);
      await client.subscribe("sessions");
      if (handle.closed) {
        client.close();
        return;
      }
      handle.client = client;
      backoffMs = initialBackoffMs;
      broadcastToRenderers({ kind: "connection", state: "up" });
      client.on("sessions.event", (event: EvtSessionsEventT) => {
        broadcastToRenderers({ kind: "event", event });
      });

      clearHeartbeat();
      handle.heartbeatTimer = setInterval(() => {
        const current = handle.client;
        if (!current || handle.closed) return;
        void current.request("daemon.status", {}, { timeoutMs: 5_000 }).catch(() => {
          disconnect();
        });
      }, heartbeatMs);
      handle.heartbeatTimer.unref();
    } catch {
      broadcastToRenderers({ kind: "connection", state: "down" });
      scheduleReconnect();
    }
  };

  function scheduleReconnect(): void {
    if (handle.closed) return;
    if (handle.reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
    handle.reconnectTimer = setTimeout(() => {
      handle.reconnectTimer = null;
      void connect();
    }, delay);
    handle.reconnectTimer.unref();
  }

  await connect();
  return handle;
}

export function stopDaemonEventClient(handle: DaemonEventClient): void {
  handle.closed = true;
  if (handle.reconnectTimer) {
    clearTimeout(handle.reconnectTimer);
    handle.reconnectTimer = null;
  }
  if (handle.heartbeatTimer) {
    clearInterval(handle.heartbeatTimer);
    handle.heartbeatTimer = null;
  }
  if (handle.client) {
    handle.client.close();
    handle.client = null;
  }
}

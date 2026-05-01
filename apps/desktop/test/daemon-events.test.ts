import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllWindows = vi.fn();
const connectDaemonClient = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock("../src/main/daemon/client-runner.js", () => ({
  connectDaemonClient,
}));

function makeClient(opts: { heartbeatRejects?: boolean } = {}) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const client = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (payload: unknown) => void) => {
      listeners.set(event, cb);
      return client;
    }),
    request: opts.heartbeatRejects
      ? vi.fn().mockRejectedValue(new Error("disconnected"))
      : vi.fn().mockResolvedValue({}),
    close: vi.fn(),
    listeners,
  };
  return client;
}

describe("daemon event forwarding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAllWindows.mockReset();
    connectDaemonClient.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts connection and session events to every live BrowserWindow", async () => {
    const send = vi.fn();
    getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
    const client = makeClient();
    connectDaemonClient.mockResolvedValue(client);

    const { startDaemonEventClient, stopDaemonEventClient } = await import(
      "../src/main/daemon/events.js"
    );
    const handle = await startDaemonEventClient("/home/.myclaude", "0.1.0");

    expect(client.subscribe).toHaveBeenCalledWith("sessions");
    expect(send).toHaveBeenCalledWith("myclaude.sessions.event", {
      kind: "connection",
      state: "up",
    });

    client.listeners.get("sessions.event")?.({
      kind: "sessions.event",
      sessionId: "s-1",
      event: "started",
      ts: 1,
    });

    expect(send).toHaveBeenCalledWith("myclaude.sessions.event", {
      kind: "event",
      event: {
        kind: "sessions.event",
        sessionId: "s-1",
        event: "started",
        ts: 1,
      },
    });

    stopDaemonEventClient(handle);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("detects heartbeat failures and reconnects with a down/up notice", async () => {
    const send = vi.fn();
    getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
    const first = makeClient({ heartbeatRejects: true });
    const second = makeClient();
    connectDaemonClient.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { startDaemonEventClient, stopDaemonEventClient } = await import(
      "../src/main/daemon/events.js"
    );
    const handle = await startDaemonEventClient("/home/.myclaude", "0.1.0", {
      heartbeatMs: 10,
      initialBackoffMs: 20,
      maxBackoffMs: 20,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(first.request).toHaveBeenCalledWith("daemon.status", {}, { timeoutMs: 5_000 });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("myclaude.sessions.event", {
      kind: "connection",
      state: "down",
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(connectDaemonClient).toHaveBeenCalledTimes(2);
    expect(second.subscribe).toHaveBeenCalledWith("sessions");
    expect(send).toHaveBeenLastCalledWith("myclaude.sessions.event", {
      kind: "connection",
      state: "up",
    });

    stopDaemonEventClient(handle);
  });

  it("clears pending reconnect timers when stopped", async () => {
    const send = vi.fn();
    getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
    connectDaemonClient.mockRejectedValue(new Error("offline"));

    const { startDaemonEventClient, stopDaemonEventClient } = await import(
      "../src/main/daemon/events.js"
    );
    const handle = await startDaemonEventClient("/home/.myclaude", "0.1.0", {
      initialBackoffMs: 20,
      maxBackoffMs: 20,
    });
    expect(connectDaemonClient).toHaveBeenCalledTimes(1);

    stopDaemonEventClient(handle);
    await vi.advanceTimersByTimeAsync(20);

    expect(connectDaemonClient).toHaveBeenCalledTimes(1);
  });
});

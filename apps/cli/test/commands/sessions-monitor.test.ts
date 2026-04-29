import type { EvtSessionsEventT } from "@agent-profile/ipc-protocol";
/**
 * Tests for the Phase 2 milestone 5 sessions subcommands: kill, relaunch,
 * drift, and `list --follow`. The harness swaps out `getTransport` with a
 * stub so we don't need a live daemon — kill/relaunch/subscribe go through
 * the daemon-only path, drift exercises both paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSessionsDrift,
  runSessionsKill,
  runSessionsList,
  runSessionsRelaunch,
} from "../../src/commands/sessions.js";
import { CliError, EXIT_USER_CANCELLED } from "../../src/errors.js";
import * as transportIndex from "../../src/transport/index.js";
import type { CliTransport } from "../../src/transport/types.js";

function createTransportStub(overrides: Partial<CliTransport>): CliTransport {
  const fail = (name: string) => async () => {
    throw new Error(`Unexpected transport.${name} call`);
  };
  return {
    transportKind: "daemon",
    authList: fail("authList"),
    authGetSecretRef: fail("authGetSecretRef"),
    profileShow: fail("profileShow"),
    sessionsList: fail("sessionsList"),
    daemonStatus: fail("daemonStatus"),
    daemonStop: fail("daemonStop"),
    authAdd: fail("authAdd"),
    authSetSecret: fail("authSetSecret"),
    authRotate: fail("authRotate"),
    authRemove: fail("authRemove"),
    secretsMigrate: fail("secretsMigrate"),
    sessionStart: fail("sessionStart"),
    sessionEnd: fail("sessionEnd"),
    sessionsKill: fail("sessionsKill"),
    sessionsRelaunch: fail("sessionsRelaunch"),
    sessionsDrift: fail("sessionsDrift"),
    sessionsSubscribe: fail("sessionsSubscribe"),
    personaRender: fail("personaRender"),
    close: async () => {},
    ...overrides,
  };
}

describe("sessions kill / relaunch / drift / list --follow", () => {
  let stdout = "";

  beforeEach(() => {
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sessions kill prints a confirmation and forwards to the daemon", async () => {
    const sessionsKill = vi.fn(async () => ({ killed: true, exitCode: 0 }));
    const transport = createTransportStub({ sessionsKill });
    vi.spyOn(transportIndex, "getTransport").mockResolvedValue(transport);

    const result = await runSessionsKill({ sessionId: "s-1", yes: true });
    expect(result).toEqual({ killed: true, exitCode: 0 });
    expect(stdout).toContain("Killed session s-1");
    expect(sessionsKill).toHaveBeenCalledWith({ sessionId: "s-1" });
  });

  it("sessions kill in JSON mode without --yes raises EXIT_USER_CANCELLED", async () => {
    const transport = createTransportStub({});
    vi.spyOn(transportIndex, "getTransport").mockResolvedValue(transport);

    let caught: unknown;
    try {
      await runSessionsKill({ sessionId: "s-1", json: true, isInteractive: false });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).exitCode).toBe(EXIT_USER_CANCELLED);
  });

  it("sessions relaunch reports the new sessionId", async () => {
    const sessionsRelaunch = vi.fn(async () => ({
      sessionId: "s-NEW",
      capabilityToken: "tok",
      expiresAtMs: 5000,
      relaunchedFrom: "s-OLD",
    }));
    const transport = createTransportStub({ sessionsRelaunch });
    vi.spyOn(transportIndex, "getTransport").mockResolvedValue(transport);

    const result = await runSessionsRelaunch({ sessionId: "s-OLD" });
    expect(result).toEqual({ sessionId: "s-NEW", relaunchedFrom: "s-OLD" });
    expect(stdout).toContain("Relaunched s-OLD as s-NEW");
  });

  it("sessions drift surfaces drift state in human output", async () => {
    const sessionsDrift = vi.fn(async () => ({
      drifted: true,
      scopesChanged: ["/repo/.myclaude/role.yml"],
      oldHash: "abc",
      newHash: "def",
    }));
    const transport = createTransportStub({ sessionsDrift });
    vi.spyOn(transportIndex, "getTransport").mockResolvedValue(transport);

    const result = await runSessionsDrift({
      sessionId: "s-DRIFT",
      home: "/tmp/home",
      sessionsRoot: "/tmp/sessions",
      standalone: false,
    });
    expect(result.drifted).toBe(true);
    expect(stdout).toContain("DRIFTED");
    expect(stdout).toContain("/repo/.myclaude/role.yml");
  });

  it("sessions list --follow streams events from the subscription until SIGINT", async () => {
    type EventCb = (evt: EvtSessionsEventT) => void;
    const cbHolder: { current: EventCb | null } = { current: null };
    const sessionsList = vi.fn(async () => []);
    const sessionsSubscribe = vi.fn(
      async (input: { onEvent: (e: EvtSessionsEventT) => void }): Promise<{
        unsubscribe: () => void;
      }> => {
        cbHolder.current = input.onEvent;
        return { unsubscribe: vi.fn() };
      }
    );
    const transport = createTransportStub({ sessionsList, sessionsSubscribe });
    vi.spyOn(transportIndex, "getTransport").mockResolvedValue(transport);

    // Kick off the follow command. It will block on the SIGINT promise.
    const followPromise = runSessionsList({
      sessionsRoot: "/tmp/sessions",
      json: true,
      follow: true,
    });

    // Yield control so the subscription is established.
    await new Promise((r) => setImmediate(r));
    expect(cbHolder.current).not.toBeNull();
    cbHolder.current?.({
      kind: "sessions.event",
      sessionId: "s-1",
      event: "killed",
      ts: 1_000,
    });
    await new Promise((r) => setImmediate(r));

    // Send the synthetic SIGINT to unwind the loop.
    process.emit("SIGINT");
    await followPromise;

    expect(stdout).toContain('"event":"killed"');
    expect(sessionsSubscribe).toHaveBeenCalledOnce();
  });
});

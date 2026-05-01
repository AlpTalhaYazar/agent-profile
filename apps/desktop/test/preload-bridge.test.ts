import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyClaudeBridge } from "../src/shared/bridge.js";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const off = vi.fn();

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke,
    on,
    off,
  },
}));

describe("preload bridge", () => {
  beforeEach(() => {
    exposeInMainWorld.mockReset();
    invoke.mockReset();
    on.mockReset();
    off.mockReset();
    vi.resetModules();
  });

  async function loadBridge(): Promise<MyClaudeBridge> {
    await import("../src/preload/index.js");
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe("myclaude");
    return exposeInMainWorld.mock.calls[0]?.[1] as MyClaudeBridge;
  }

  it("exposes the expected window.myclaude API shape", async () => {
    const api = await loadBridge();

    expect(api).toHaveProperty("system.version");
    expect(api).toHaveProperty("system.defaultCwd");
    expect(api).toHaveProperty("system.pickDirectory");
    expect(api).toHaveProperty("auth.list");
    expect(api).toHaveProperty("auth.add");
    expect(api).toHaveProperty("auth.setSecret");
    expect(api).toHaveProperty("auth.rotate");
    expect(api).toHaveProperty("auth.remove");
    expect(api).toHaveProperty("auth.updateMeta");
    expect(api).toHaveProperty("oauth.start");
    expect(api).toHaveProperty("oauth.refresh");
    expect(api).toHaveProperty("oauth.detect");
    expect(api).toHaveProperty("oauth.adopt");
    expect(api).toHaveProperty("profile.list");
    expect(api).toHaveProperty("profile.show");
    expect(api).toHaveProperty("profile.validate");
    expect(api).toHaveProperty("profile.preview");
    expect(api).toHaveProperty("profile.save");
    expect(api).toHaveProperty("persona.render");
    expect(api).toHaveProperty("sessions.list");
    expect(api).toHaveProperty("sessions.kill");
    expect(api).toHaveProperty("sessions.relaunch");
    expect(api).toHaveProperty("sessions.drift");
    expect(api).toHaveProperty("sessions.onUpdate");
  });

  it("forwards renderer calls onto the expected ipc channels", async () => {
    const api = await loadBridge();

    await api.system.version();
    await api.system.defaultCwd();
    await api.system.pickDirectory();
    await api.auth.list();
    await api.auth.add({
      spec: {
        id: "work",
        anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
      },
    });
    await api.auth.setSecret({
      profileId: "work",
      name: "github",
      value: "secret",
      register: true,
    });
    await api.auth.rotate({ profileId: "work", value: "new-secret" });
    await api.auth.remove({ profileId: "work", yes: true });
    await api.auth.updateMeta({ profileId: "work", displayName: "Work" });
    await api.oauth.start({ profileId: "web", displayName: "Web" });
    await api.oauth.refresh({ authId: "web" });
    await api.oauth.detect();
    await api.oauth.adopt({ profileId: "adopted", displayName: "Claude Code" });
    await api.profile.list({ cwd: "/repo", roleFilter: "backend" });
    await api.profile.show({ role: "backend", authProfileId: "work", cwd: "/repo" });
    await api.profile.validate({ content: { version: 1 } });
    await api.profile.preview({
      role: "backend",
      authProfileId: "work",
      cwd: "/repo",
      draft: { path: "/repo/.myclaude/roles/backend.yml", content: { version: 1 } },
    });
    await api.profile.save({ path: "/repo/.myclaude/shared.yml", content: { version: 1 } });
    await api.persona.render({ role: "backend", authProfileId: "work", cwd: "/repo" });
    await api.sessions.list();
    await api.sessions.kill({ sessionId: "s-1", signal: "SIGKILL" });
    await api.sessions.relaunch({ sessionId: "s-1" });
    await api.sessions.drift({ sessionId: "s-1" });

    expect(invoke.mock.calls).toEqual([
      ["system.version"],
      ["system.defaultCwd"],
      ["system.pickDirectory"],
      ["auth.list"],
      [
        "auth.add",
        {
          spec: {
            id: "work",
            anthropic: { mode: "apiKey", secretRef: "keyring://anthropic/work" },
          },
        },
      ],
      ["auth.setSecret", { profileId: "work", name: "github", value: "secret", register: true }],
      ["auth.rotate", { profileId: "work", value: "new-secret" }],
      ["auth.remove", { profileId: "work", yes: true }],
      ["auth.updateMeta", { profileId: "work", displayName: "Work" }],
      ["auth.oauth.start", { profileId: "web", displayName: "Web" }],
      ["auth.oauth.refresh", { authId: "web" }],
      ["auth.oauth.detect"],
      ["auth.oauth.adopt", { profileId: "adopted", displayName: "Claude Code" }],
      ["profile.list", { cwd: "/repo", roleFilter: "backend" }],
      ["profile.show", { role: "backend", authProfileId: "work", cwd: "/repo" }],
      ["profile.validate", { content: { version: 1 } }],
      [
        "profile.preview",
        {
          role: "backend",
          authProfileId: "work",
          cwd: "/repo",
          draft: { path: "/repo/.myclaude/roles/backend.yml", content: { version: 1 } },
        },
      ],
      ["profile.save", { path: "/repo/.myclaude/shared.yml", content: { version: 1 } }],
      ["persona.render", { role: "backend", authProfileId: "work", cwd: "/repo" }],
      ["sessions.list"],
      ["sessions.kill", { sessionId: "s-1", signal: "SIGKILL" }],
      ["sessions.relaunch", { sessionId: "s-1" }],
      ["sessions.drift", { sessionId: "s-1" }],
    ]);
  });

  it("subscribes and unsubscribes from session update events", async () => {
    const api = await loadBridge();
    const cb = vi.fn();

    const dispose = api.sessions.onUpdate(cb);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0]?.[0]).toBe("myclaude.sessions.event");

    const listener = on.mock.calls[0]?.[1] as (event: unknown, payload: unknown) => void;
    const payload = { kind: "connection", state: "down" };
    listener({}, payload);
    expect(cb).toHaveBeenCalledWith(payload);

    dispose();
    expect(off).toHaveBeenCalledWith("myclaude.sessions.event", listener);
  });
});

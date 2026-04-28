import { beforeEach, describe, expect, it, vi } from "vitest";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke,
  },
}));

describe("preload bridge", () => {
  beforeEach(() => {
    exposeInMainWorld.mockReset();
    invoke.mockReset();
    vi.resetModules();
  });

  it("exposes the expected window.myclaude API shape", async () => {
    await import("../src/preload/index.js");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe("myclaude");
    const api = exposeInMainWorld.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(api).toHaveProperty("system.version");
    expect(api).toHaveProperty("system.defaultCwd");
    expect(api).toHaveProperty("system.pickDirectory");
    expect(api).toHaveProperty("auth.list");
    expect(api).toHaveProperty("profile.list");
    expect(api).toHaveProperty("profile.show");
    expect(api).toHaveProperty("profile.validate");
    expect(api).toHaveProperty("profile.preview");
    expect(api).toHaveProperty("profile.save");
  });

  it("forwards renderer calls onto the expected ipc channels", async () => {
    await import("../src/preload/index.js");
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      system: {
        version: () => Promise<unknown>;
        defaultCwd: () => Promise<unknown>;
        pickDirectory: () => Promise<unknown>;
      };
      auth: { list: () => Promise<unknown> };
      profile: {
        list: (opts: { cwd: string; roleFilter?: string }) => Promise<unknown>;
        show: (opts: { role: string; authProfileId: string; cwd: string }) => Promise<unknown>;
        validate: (opts: { content: unknown }) => Promise<unknown>;
        preview: (opts: {
          role: string;
          authProfileId: string;
          cwd: string;
          draft: { path: string; content: unknown };
        }) => Promise<unknown>;
        save: (opts: { path: string; content: unknown }) => Promise<unknown>;
      };
    };

    await api.system.version();
    await api.system.defaultCwd();
    await api.system.pickDirectory();
    await api.auth.list();
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

    expect(invoke.mock.calls).toEqual([
      ["system.version"],
      ["system.defaultCwd"],
      ["system.pickDirectory"],
      ["auth.list"],
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
    ]);
  });
});

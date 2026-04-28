import { beforeEach, describe, expect, it, vi } from "vitest";

const handlerMap = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
const ipcMainHandle = vi.fn(
  (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
    handlerMap.set(channel, handler);
  }
);
const showOpenDialog = vi.fn();
const fromWebContents = vi.fn(() => undefined);
const connectToSocket = vi.fn();
const readCookie = vi.fn();
const defaultSocketPath = vi.fn(() => "/tmp/myclaude.sock");

vi.mock("electron", () => {
  return {
    BrowserWindow: {
      fromWebContents,
    },
    app: {
      getVersion: vi.fn(() => "0.1.0"),
      on: vi.fn(),
      requestSingleInstanceLock: vi.fn(),
      whenReady: vi.fn(),
      quit: vi.fn(),
      exit: vi.fn(),
    },
    dialog: {
      showOpenDialog,
    },
    ipcMain: {
      handle: ipcMainHandle,
    },
    safeStorage: {},
  };
});

vi.mock("@agent-profile/ipc-protocol", () => ({
  connectToSocket,
  readCookie,
  defaultSocketPath,
}));

describe("main renderer IPC bridge", () => {
  beforeEach(() => {
    handlerMap.clear();
    ipcMainHandle.mockClear();
    showOpenDialog.mockReset();
    fromWebContents.mockReset();
    connectToSocket.mockReset();
    readCookie.mockReset();
    defaultSocketPath.mockClear();
    vi.resetModules();
  });

  it("registers handlers and delegates auth/profile calls through short-lived daemon clients", async () => {
    const close = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        id: "c-1",
        kind: "auth.list.ok",
        profiles: [{ id: "work", displayName: "Work", mode: "apiKey", secrets: [] }],
      })
      .mockResolvedValueOnce({
        id: "c-2",
        kind: "profile.show.ok",
        effective: { env: { EDITOR: "nvim" } },
        provenance: {},
      });
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");

    const { registerRendererIpcHandlers } = await import("../src/main/index.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      startupCwd: "/repo",
    });

    const authList = handlerMap.get("auth.list");
    const profileShow = handlerMap.get("profile.show");
    if (!authList || !profileShow) throw new Error("missing registered handlers");

    const event = {
      senderFrame: { url: "file:///trusted/index.html" },
      sender: {},
    };

    await expect(authList(event, undefined)).resolves.toEqual({
      profiles: [{ id: "work", displayName: "Work", mode: "apiKey", secrets: [] }],
    });
    await expect(
      profileShow(event, { role: "backend", authProfileId: "work", cwd: "/repo" })
    ).resolves.toEqual({
      effective: { env: { EDITOR: "nvim" } },
      provenance: {},
    });

    expect(readCookie).toHaveBeenCalledTimes(2);
    expect(readCookie).toHaveBeenCalledWith("/Users/test/.myclaude");
    expect(connectToSocket).toHaveBeenCalledWith({
      socketPath: "/tmp/myclaude.sock",
      clientVersion: "0.1.0",
      cookie: "cookie-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "auth.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "profile.show", {
      role: "backend",
      authProfileId: "work",
      cwd: "/repo",
    });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid renderer payloads before they reach the daemon", async () => {
    const { registerRendererIpcHandlers } = await import("../src/main/index.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
    });

    const profileSave = handlerMap.get("profile.save");
    if (!profileSave) throw new Error("missing profile.save handler");

    await expect(
      profileSave({ senderFrame: { url: "file:///trusted/index.html" }, sender: {} }, { path: "" })
    ).rejects.toThrow(/invalid payload/);
    expect(connectToSocket).not.toHaveBeenCalled();
  });

  it("handles system.defaultCwd and system.pickDirectory locally in Main", async () => {
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/picked/project"],
    });

    const { registerRendererIpcHandlers } = await import("../src/main/index.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      startupCwd: "/repo",
    });

    const defaultCwd = handlerMap.get("system.defaultCwd");
    const pickDirectory = handlerMap.get("system.pickDirectory");
    if (!defaultCwd || !pickDirectory) throw new Error("missing system handlers");

    const event = {
      senderFrame: { url: "file:///trusted/index.html" },
      sender: { id: 1 },
    };

    await expect(defaultCwd(event, undefined)).resolves.toBe("/repo");
    await expect(pickDirectory(event, undefined)).resolves.toBe("/picked/project");
  });

  it("resolves the nested renderer HTML path in dev and packaged modes", async () => {
    const { rendererEntryUrl } = await import("../src/main/index.js");

    expect(rendererEntryUrl({ devServerUrl: "http://localhost:5173" })).toBe(
      "http://localhost:5173/src/renderer/index.html"
    );
    expect(rendererEntryUrl({ devServerUrl: "http://localhost:5174/" })).toBe(
      "http://localhost:5174/src/renderer/index.html"
    );
    expect(
      rendererEntryUrl({
        baseDir: "/app/.vite/build",
        rendererName: "main_window",
      })
    ).toBe("file:///app/.vite/renderer/main_window/src/renderer/index.html");
  });
});

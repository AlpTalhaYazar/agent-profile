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
const runOAuthFlow = vi.fn();
const detectClaudeCodeCredentials = vi.fn();
const fetchClientMetadata = vi.fn();
const refreshAccessToken = vi.fn();

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

vi.mock("../src/main/oauth/flow.js", () => ({
  runOAuthFlow,
}));

vi.mock("../src/main/oauth/detect.js", () => ({
  detectClaudeCodeCredentials,
}));

vi.mock("../src/main/oauth/token-client.js", () => ({
  fetchClientMetadata,
  refreshAccessToken,
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
    runOAuthFlow.mockReset();
    detectClaudeCodeCredentials.mockReset();
    fetchClientMetadata.mockReset();
    refreshAccessToken.mockReset();
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

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
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

  it("delegates persona.render to the daemon and forwards the projected wire shape", async () => {
    const close = vi.fn();
    const request = vi.fn().mockResolvedValueOnce({
      id: "c-1",
      kind: "persona.render.ok",
      claudeMd: {
        combinedContent: "<!-- source: global-role -->\nbackend\n",
        sections: [
          {
            sourcePath: "/p/persona/backend.md",
            originScope: "global-role",
            content: "backend\n",
          },
        ],
      },
      files: [
        {
          category: "agents",
          basename: "api-designer.md",
          sourcePath: "/p/agents/api-designer.md",
          originScope: "global-role",
          content: "agent body",
        },
      ],
      collisions: [],
      missingSources: [],
    });
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      startupCwd: "/repo",
    });

    const personaRender = handlerMap.get("persona.render");
    if (!personaRender) throw new Error("missing persona.render handler");

    const event = {
      senderFrame: { url: "file:///trusted/index.html" },
      sender: {},
    };

    const result = (await personaRender(event, {
      role: "backend",
      authProfileId: "work",
      cwd: "/repo",
    })) as {
      claudeMd: { combinedContent: string; sections: unknown[] } | null;
      files: unknown[];
      collisions: unknown[];
      missingSources: unknown[];
    };

    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd?.sections).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.collisions).toEqual([]);
    expect(result.missingSources).toEqual([]);
    expect(request).toHaveBeenCalledWith("persona.render", {
      role: "backend",
      authProfileId: "work",
      cwd: "/repo",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid persona.render payload before opening a daemon connection", async () => {
    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
    });

    const personaRender = handlerMap.get("persona.render");
    if (!personaRender) throw new Error("missing persona.render handler");

    await expect(
      personaRender(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        { role: "" } // missing authProfileId + cwd
      )
    ).rejects.toThrow(/invalid payload/);
    expect(connectToSocket).not.toHaveBeenCalled();
  });

  it("rejects invalid renderer payloads before they reach the daemon", async () => {
    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
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

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
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

  it("persists oauth.start once and stores refresh token without replacing the access-token ref", async () => {
    const close = vi.fn();
    const request = vi.fn().mockResolvedValueOnce({ id: "c-1", kind: "auth.add.ok" });
    const store = { set: vi.fn(), get: vi.fn() };
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");
    runOAuthFlow.mockResolvedValue({
      profileId: "web",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
      email: "dev@example.com",
      orgName: "Example",
      planType: "max",
    });

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      store: store as never,
    });

    const oauthStart = handlerMap.get("auth.oauth.start");
    if (!oauthStart) throw new Error("missing auth.oauth.start handler");

    await expect(
      oauthStart(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        { profileId: "web", displayName: "Web" }
      )
    ).resolves.toEqual({
      profileId: "web",
      oauth: {
        email: "dev@example.com",
        orgName: "Example",
        planType: "max",
      },
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("auth.add", {
      spec: {
        id: "web",
        displayName: "Web",
        anthropic: {
          mode: "oauth",
          secretRef: "keyring://anthropic/web",
          oauth: {
            email: "dev@example.com",
            orgName: "Example",
            planType: "max",
            accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
            refreshTokenRef: "keyring://anthropic-oauth-refresh/web",
          },
        },
      },
      anthropicSecretB64: Buffer.from("access-token", "utf8").toString("base64"),
      force: true,
    });
    expect(store.set).toHaveBeenCalledWith(
      "agent-profile.anthropic-oauth-refresh.web",
      "refresh-token"
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("adopts detected OAuth credentials using the access-token ref as the profile secret", async () => {
    const close = vi.fn();
    const request = vi.fn().mockResolvedValueOnce({ id: "c-1", kind: "auth.add.ok" });
    const store = { set: vi.fn(), get: vi.fn() };
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");
    detectClaudeCodeCredentials.mockResolvedValue({
      detected: true,
      accessToken: "detected-access",
      refreshToken: "detected-refresh",
      accessTokenExpiresAt: "2026-05-01T12:00:00.000Z",
      planType: "pro",
    });

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      store: store as never,
    });

    const adopt = handlerMap.get("auth.oauth.adopt");
    if (!adopt) throw new Error("missing auth.oauth.adopt handler");

    await expect(
      adopt(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        { profileId: "claude-code", displayName: "Claude Code" }
      )
    ).resolves.toEqual({ profileId: "claude-code" });

    expect(request).toHaveBeenCalledWith(
      "auth.add",
      expect.objectContaining({
        spec: expect.objectContaining({
          id: "claude-code",
          anthropic: expect.objectContaining({
            secretRef: "keyring://anthropic/claude-code",
            oauth: expect.objectContaining({
              refreshTokenRef: "keyring://anthropic-oauth-refresh/claude-code",
            }),
          }),
        }),
        anthropicSecretB64: Buffer.from("detected-access", "utf8").toString("base64"),
        force: true,
      })
    );
    expect(store.set).toHaveBeenCalledWith(
      "agent-profile.anthropic-oauth-refresh.claude-code",
      "detected-refresh"
    );
  });

  it("refreshes OAuth using the refresh-token ref and daemon rotate/update-meta calls", async () => {
    const close = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        id: "c-1",
        kind: "auth.list.ok",
        profiles: [
          {
            id: "web",
            displayName: "Web",
            mode: "oauth",
            secrets: [],
            oauth: { refreshTokenRef: "keyring://anthropic-oauth-refresh/web" },
          },
        ],
      })
      .mockResolvedValueOnce({ id: "c-2", kind: "auth.rotate.ok" })
      .mockResolvedValueOnce({ id: "c-3", kind: "auth.update-meta.ok" });
    const store = { get: vi.fn().mockResolvedValue("old-refresh"), set: vi.fn() };
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");
    fetchClientMetadata.mockResolvedValue({ client_id: "client-id" });
    refreshAccessToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      token_type: "Bearer",
      expires_in: 3600,
    });

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      store: store as never,
    });

    const refresh = handlerMap.get("auth.oauth.refresh");
    if (!refresh) throw new Error("missing auth.oauth.refresh handler");

    await expect(
      refresh({ senderFrame: { url: "file:///trusted/index.html" }, sender: {} }, { authId: "web" })
    ).resolves.toEqual({
      refreshed: true,
      accessTokenExpiresAt: expect.any(String),
    });

    expect(store.get).toHaveBeenCalledWith("agent-profile.anthropic-oauth-refresh.web");
    expect(fetchClientMetadata).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledWith("old-refresh", "client-id");
    expect(request).toHaveBeenNthCalledWith(1, "auth.list", { includeRefs: true });
    expect(request).toHaveBeenNthCalledWith(2, "auth.rotate", {
      authId: "web",
      anthropicSecretB64: Buffer.from("new-access", "utf8").toString("base64"),
    });
    expect(request).toHaveBeenNthCalledWith(3, "auth.update-meta", {
      authId: "web",
      oauth: {
        accessTokenExpiresAt: expect.any(String),
        refreshTokenRef: "keyring://anthropic-oauth-refresh/web",
      },
    });
    expect(store.set).toHaveBeenCalledWith(
      "agent-profile.anthropic-oauth-refresh.web",
      "new-refresh"
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("resolves the nested renderer HTML path in dev and packaged modes", async () => {
    const { rendererEntryUrl } = await import("../src/main/window/entry.js");

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

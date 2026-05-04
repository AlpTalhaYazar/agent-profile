import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlerMap = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
const ipcMainHandle = vi.fn(
  (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
    handlerMap.set(channel, handler);
  }
);
const showOpenDialog = vi.fn();
const fromWebContents = vi.fn((): unknown => undefined);
const connectToSocket = vi.fn();
const readCookie = vi.fn();
const defaultSocketPath = vi.fn(() => "/tmp/myclaude.sock");
const runOAuthFlow = vi.fn();
const detectClaudeCodeCredentials = vi.fn();
const fetchClientMetadata = vi.fn();
const refreshAccessToken = vi.fn();
const listNativeClaudeHistory = vi.fn();
const launchTerminalSession = vi.fn();
const resumeNativeClaudeSession = vi.fn();
const openTerminalSession = vi.fn();
const isTerminalSessionAttachable = vi.fn<(sessionId: string) => boolean>(() => false);
const writeTerminalSession = vi.fn();
const resizeTerminalSession = vi.fn();
const closeTerminalSession = vi.fn();
const skillsSearch = vi.fn();
const skillsDetail = vi.fn();
const skillsAudit = vi.fn();
const skillsListInstalled = vi.fn();
const skillsInstall = vi.fn();
const requestSecretInputViaMain = vi.fn();

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

vi.mock("../src/main/native-claude-history.js", () => ({
  listNativeClaudeHistory,
}));

vi.mock("../src/main/session-terminal.js", () => ({
  closeTerminalSession,
  isTerminalSessionAttachable,
  launchTerminalSession,
  openTerminalSession,
  resumeNativeClaudeSession,
  resizeTerminalSession,
  writeTerminalSession,
}));

vi.mock("../src/main/skills-service.js", () => ({
  skillsSearch,
  skillsDetail,
  skillsAudit,
  skillsListInstalled,
  skillsInstall,
}));

vi.mock("../src/main/native-secret-dialog.js", () => ({
  requestSecretInputViaMain,
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
    listNativeClaudeHistory.mockReset();
    launchTerminalSession.mockReset();
    resumeNativeClaudeSession.mockReset();
    openTerminalSession.mockReset();
    isTerminalSessionAttachable.mockReset();
    isTerminalSessionAttachable.mockReturnValue(false);
    writeTerminalSession.mockReset();
    resizeTerminalSession.mockReset();
    closeTerminalSession.mockReset();
    skillsSearch.mockReset();
    skillsDetail.mockReset();
    skillsAudit.mockReset();
    skillsListInstalled.mockReset();
    skillsInstall.mockReset();
    requestSecretInputViaMain.mockReset();
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

  it("delegates auth.add through Main after collecting and encoding the native secret", async () => {
    const close = vi.fn();
    const request = vi.fn().mockResolvedValueOnce({ id: "c-1", kind: "auth.add.ok" });
    const parentWindow = { id: 99 };
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");
    fromWebContents.mockReturnValue(parentWindow);
    requestSecretInputViaMain.mockResolvedValue("sk-ant-plain");

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      startupCwd: "/repo",
    });

    const authAdd = handlerMap.get("auth.add");
    if (!authAdd) throw new Error("missing auth.add handler");

    const event = {
      senderFrame: { url: "file:///trusted/index.html" },
      sender: {},
    };
    const payload = {
      spec: {
        id: "work",
        displayName: "Work",
        anthropic: {
          mode: "apiKey",
          secretRef: "keyring://anthropic/work",
        },
      },
      force: true,
    };

    await expect(authAdd(event, payload)).resolves.toEqual({ ok: true });

    expect(requestSecretInputViaMain).toHaveBeenCalledWith({
      parent: parentWindow,
      title: 'Add Claude credential "work"',
      label: "Anthropic API key",
    });
    expect(request).toHaveBeenCalledWith("auth.add", {
      spec: payload.spec,
      anthropicSecretB64: Buffer.from("sk-ant-plain", "utf8").toString("base64"),
      force: true,
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects auth.add cancellation before any daemon request is made", async () => {
    requestSecretInputViaMain.mockResolvedValue(null);

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      startupCwd: "/repo",
    });

    const authAdd = handlerMap.get("auth.add");
    if (!authAdd) throw new Error("missing auth.add handler");

    await expect(
      authAdd(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        {
          spec: {
            id: "work",
            anthropic: {
              mode: "apiKey",
              secretRef: "keyring://anthropic/work",
            },
          },
        }
      )
    ).rejects.toThrow("auth.add: cancelled");

    expect(connectToSocket).not.toHaveBeenCalled();
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

  it("delegates profile.createScope to the daemon", async () => {
    const close = vi.fn();
    const request = vi.fn().mockResolvedValueOnce({
      id: "c-1",
      kind: "profile.createScope.ok",
      created: true,
      path: "/repo/.myclaude/roles/backend.yml",
      scope: "project-role",
      role: "backend",
      content: { version: 1, mcpServers: {}, env: {}, settings: {}, use: [], disabledServers: [] },
    });
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
    });

    const profileCreateScope = handlerMap.get("profile.createScope");
    if (!profileCreateScope) throw new Error("missing profile.createScope handler");

    await expect(
      profileCreateScope(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        {
          cwd: "/repo",
          location: "project",
          layerType: "role",
          role: "backend",
        }
      )
    ).resolves.toEqual({
      created: true,
      path: "/repo/.myclaude/roles/backend.yml",
      scope: "project-role",
      role: "backend",
      content: { version: 1, mcpServers: {}, env: {}, settings: {}, use: [], disabledServers: [] },
    });
    expect(request).toHaveBeenCalledWith("profile.createScope", {
      cwd: "/repo",
      location: "project",
      layerType: "role",
      role: "backend",
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("composes workspace profile sessions with native Claude history", async () => {
    const close = vi.fn();
    const request = vi.fn().mockResolvedValueOnce({
      id: "c-1",
      kind: "sessions.list.ok",
      sessions: [
        {
          sessionId: "profile-1",
          cwd: "/repo",
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:00:00.000Z",
          status: "exited",
          spawn: { command: "claude", args: [] },
        },
        {
          sessionId: "other-1",
          cwd: "/other",
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:00:00.000Z",
          status: "exited",
        },
      ],
    });
    connectToSocket.mockResolvedValue({ request, close });
    readCookie.mockResolvedValue("cookie-1");
    isTerminalSessionAttachable.mockImplementation((sessionId: string) => sessionId === "native-1");
    listNativeClaudeHistory.mockResolvedValue([
      {
        source: "claude-native",
        sessionId: "native-1",
        cwd: "/repo",
        status: "history",
        createdAt: "2026-05-01T11:00:00.000Z",
        updatedAt: "2026-05-01T11:00:00.000Z",
        attachable: false,
        resumable: true,
      },
    ]);

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
    });

    const sessionsList = handlerMap.get("sessions.list");
    if (!sessionsList) throw new Error("missing sessions.list handler");

    await expect(
      sessionsList(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        { cwd: "/repo", includeNative: true }
      )
    ).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          source: "claude-native",
          sessionId: "native-1",
          attachable: true,
          resumable: false,
        }),
        expect.objectContaining({
          source: "profile",
          sessionId: "profile-1",
          attachable: false,
        }),
      ],
    });
    expect(request).toHaveBeenCalledWith("sessions.list", {});
    expect(listNativeClaudeHistory).toHaveBeenCalledWith({ cwd: "/repo" });
  });

  it("delegates terminal session controls and preserves void returns for close/write/resize", async () => {
    launchTerminalSession.mockResolvedValue({ sessionId: "launched-1" });
    resumeNativeClaudeSession.mockResolvedValue({ sessionId: "native-1" });
    openTerminalSession.mockReturnValue({
      sessionId: "launched-1",
      attached: true,
      buffer: "ready",
    });

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    const context = {
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      clientVersion: "0.1.0",
    };
    registerRendererIpcHandlers(context);

    const event = { senderFrame: { url: "file:///trusted/index.html" }, sender: {} };
    const launch = handlerMap.get("sessions.launch");
    const open = handlerMap.get("sessions.openTerminal");
    const write = handlerMap.get("sessions.writeTerminal");
    const resize = handlerMap.get("sessions.resizeTerminal");
    const closeTerminal = handlerMap.get("sessions.closeTerminal");
    if (!launch || !open || !write || !resize || !closeTerminal) {
      throw new Error("missing terminal session handlers");
    }

    await expect(
      launch(event, {
        role: "backend",
        authProfileId: "work",
        cwd: "/repo",
        passthroughArgs: ["--debug"],
        bare: true,
        strict: false,
      })
    ).resolves.toEqual({ sessionId: "launched-1" });
    await expect(open(event, { sessionId: "launched-1" })).resolves.toEqual({
      sessionId: "launched-1",
      attached: true,
      buffer: "ready",
    });
    await expect(write(event, { sessionId: "launched-1", data: "hello\n" })).resolves.toBe(
      undefined
    );
    await expect(resize(event, { sessionId: "launched-1", cols: 100, rows: 30 })).resolves.toBe(
      undefined
    );
    await expect(closeTerminal(event, { sessionId: "launched-1" })).resolves.toBe(undefined);

    expect(launchTerminalSession).toHaveBeenCalledWith(
      {
        role: "backend",
        authProfileId: "work",
        cwd: "/repo",
        passthroughArgs: ["--debug"],
        bare: true,
        strict: false,
      },
      expect.objectContaining({ myClaudeHome: "/Users/test/.myclaude" })
    );
    expect(openTerminalSession).toHaveBeenCalledWith("launched-1");
    expect(writeTerminalSession).toHaveBeenCalledWith("launched-1", "hello\n");
    expect(resizeTerminalSession).toHaveBeenCalledWith("launched-1", 100, 30);
    expect(closeTerminalSession).toHaveBeenCalledWith("launched-1");
  });

  it("delegates skills catalog IPC locally and validates install payloads before execution", async () => {
    skillsSearch.mockResolvedValue({
      skills: [{ id: "postgres", slug: "postgres", name: "Postgres", source: "org/repo" }],
    });
    skillsDetail.mockResolvedValue({ id: "postgres", readme: "..." });
    skillsAudit.mockResolvedValue({ id: "postgres", status: "passed" });
    skillsListInstalled.mockResolvedValue({ skills: [] });
    skillsInstall.mockResolvedValue({
      installed: true,
      name: "postgres",
      path: "/Users/test/.claude/skills/postgres",
    });

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    registerRendererIpcHandlers({
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
    });

    const event = { senderFrame: { url: "file:///trusted/index.html" }, sender: {} };
    const skillsSearchHandler = handlerMap.get("skills.search");
    const skillsDetailHandler = handlerMap.get("skills.detail");
    const skillsAuditHandler = handlerMap.get("skills.audit");
    const skillsListInstalledHandler = handlerMap.get("skills.listInstalled");
    const skillsInstallHandler = handlerMap.get("skills.install");
    if (
      !skillsSearchHandler ||
      !skillsDetailHandler ||
      !skillsAuditHandler ||
      !skillsListInstalledHandler ||
      !skillsInstallHandler
    ) {
      throw new Error("missing skills handlers");
    }

    await expect(skillsSearchHandler(event, { query: "postgres", limit: 5 })).resolves.toEqual(
      expect.objectContaining({ skills: expect.any(Array) })
    );
    expect(skillsSearch).toHaveBeenCalledWith({ query: "postgres", limit: 5 });
    await expect(skillsDetailHandler(event, { id: "postgres" })).resolves.toEqual({
      id: "postgres",
      readme: "...",
    });
    await expect(skillsAuditHandler(event, { id: "postgres" })).resolves.toEqual({
      id: "postgres",
      status: "passed",
    });
    await expect(
      skillsListInstalledHandler(event, { scope: "global", agent: "claude-code" })
    ).resolves.toEqual({
      skills: [],
    });
    await expect(
      skillsInstallHandler(event, {
        id: "postgres",
        slug: "postgres",
        source: "org/repo",
        installUrl: "https://github.com/org/repo",
      })
    ).resolves.toEqual({
      installed: true,
      name: "postgres",
      path: "/Users/test/.claude/skills/postgres",
    });
    await expect(
      skillsInstallHandler(event, {
        id: "postgres",
        slug: "",
        source: "org/repo",
      })
    ).rejects.toThrow(/invalid payload/);
    expect(connectToSocket).not.toHaveBeenCalled();
  });

  it("delegates native Claude resume to the terminal runtime", async () => {
    resumeNativeClaudeSession.mockResolvedValue({ sessionId: "native-1" });

    const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
    const context = {
      expectedFrameUrl: "file:///trusted/index.html",
      myClaudeHome: "/Users/test/.myclaude",
      clientVersion: "0.1.0",
    };
    registerRendererIpcHandlers(context);

    const resumeNative = handlerMap.get("sessions.resumeNative");
    if (!resumeNative) throw new Error("missing sessions.resumeNative handler");

    await expect(
      resumeNative(
        { senderFrame: { url: "file:///trusted/index.html" }, sender: {} },
        { sessionId: "native-1", cwd: "/repo" }
      )
    ).resolves.toEqual({ sessionId: "native-1" });
    expect(resumeNativeClaudeSession).toHaveBeenCalledWith(
      { sessionId: "native-1", cwd: "/repo" },
      expect.objectContaining({ myClaudeHome: "/Users/test/.myclaude" })
    );
  });

  it("handles system.defaultCwd, system.pickDirectory, and workspace candidates locally in Main", async () => {
    showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/picked/project"],
    });
    const root = mkdtempSync(join(tmpdir(), "desktop-workspace-candidates-"));
    const packageDir = join(root, "apps", "web");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "web" }));

    try {
      const { registerRendererIpcHandlers } = await import("../src/main/ipc/register.js");
      registerRendererIpcHandlers({
        expectedFrameUrl: "file:///trusted/index.html",
        myClaudeHome: "/Users/test/.myclaude",
        startupCwd: "/repo",
      });

      const defaultCwd = handlerMap.get("system.defaultCwd");
      const pickDirectory = handlerMap.get("system.pickDirectory");
      const workspaceCandidates = handlerMap.get("system.workspaceCandidates");
      if (!defaultCwd || !pickDirectory || !workspaceCandidates) {
        throw new Error("missing system handlers");
      }

      const event = {
        senderFrame: { url: "file:///trusted/index.html" },
        sender: { id: 1 },
      };

      await expect(defaultCwd(event, undefined)).resolves.toBe("/repo");
      await expect(pickDirectory(event, undefined)).resolves.toBe("/picked/project");
      await expect(workspaceCandidates(event, { cwd: join(packageDir, "src") })).resolves.toEqual([
        expect.objectContaining({ kind: "root", path: root }),
        expect.objectContaining({ kind: "package", path: packageDir }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

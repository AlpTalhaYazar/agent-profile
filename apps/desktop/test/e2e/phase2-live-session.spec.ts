import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type Page, chromium, expect, test } from "@playwright/test";
import electronExecutable from "electron";

const sessionIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const electronExecutablePath = electronExecutable as unknown as string;

test("packaged app launches a live Claude session and kills it cleanly", async () => {
  const packagedAppEntry = findPackagedAppEntry();
  expect(
    packagedAppEntry,
    `missing packaged desktop app.asar under ${join(process.cwd(), "out")}; run pnpm --filter @agent-profile/desktop package first`
  ).toBeTruthy();
  expect(
    existsSync(electronExecutablePath),
    `missing Electron executable at ${electronExecutablePath}`
  ).toBe(true);

  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "ap-p2-live-"));
  const homeDir = join(root, "home");
  const myClaudeHome = join(homeDir, ".myclaude");
  const projectDir = join(root, "project");
  const socketPath = join(root, "mc.sock");
  const stubPath = join(root, "claude");
  const electronUserDataDir = join(root, "electron-user-data");
  const remoteDebuggingPort = await getAvailablePort();

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });

  await seedProfileFiles({
    homeDir,
    myClaudeHome,
    projectDir,
  });
  await writeClaudeStub(stubPath);
  const realProjectDir = await realpath(projectDir);
  const appArgs = [
    "--inspect=0",
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${electronUserDataDir}`,
    packagedAppEntry as string,
  ];

  const app = spawn(electronExecutablePath, appArgs, {
    cwd: projectDir,
    env: {
      ...launchEnv,
      HOME: homeDir,
      MYCLAUDE_ALLOW_PLAINTEXT: "1",
      MYCLAUDE_CLAUDE_COMMAND: stubPath,
      MYCLAUDE_E2E_PLAINTEXT_SECRETS: "1",
      MYCLAUDE_HOME: myClaudeHome,
      MYCLAUDE_SOCKET: socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
    stdio: "pipe",
  });

  let browser: Browser | null = null;

  try {
    const devToolsWsEndpoint = await waitForDevToolsWsEndpoint(app);
    browser = await connectToPackagedApp(devToolsWsEndpoint);
    const page = await firstAppPage(browser);
    await page.bringToFront();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();

    await page.getByRole("button", { name: "Launch Claude" }).first().click();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toContainText(sessionIdPattern, { timeout: 20_000 });
    await expect(firstRow).toContainText("backend");
    await expect(firstRow).toContainText("work");

    const sessionText = await firstRow.innerText();
    const sessionId = sessionText.match(sessionIdPattern)?.[0];
    expect(sessionId).toBeTruthy();
    if (!sessionId) throw new Error("Missing launched session id.");

    await expect
      .poll(async () => await terminalText(page), { timeout: 20_000 })
      .toContain("[phase2-stub] ready");
    await expect
      .poll(async () => await terminalText(page), { timeout: 20_000 })
      .toContain(`[phase2-stub] session ${sessionId}`);
    await expect
      .poll(async () => await terminalText(page), { timeout: 20_000 })
      .toContain(`[phase2-stub] cwd ${realProjectDir}`);
    await expect
      .poll(async () => await terminalText(page), { timeout: 20_000 })
      .toContain("--strict-mcp-config");

    const runningRow = page.locator("tbody tr").filter({ hasText: sessionId }).first();
    const killButton = page.getByRole("button", { name: "Kill", exact: true }).first();
    await expect(killButton).toBeVisible({ timeout: 20_000 });

    await killButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("dialog", { name: `Kill session "${sessionId}"?` })).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Kill", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());

    await expect(page.getByRole("button", { name: "Kill", exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(runningRow).toContainText("exit 0", { timeout: 20_000 });
    await expect
      .poll(async () => await terminalText(page), { timeout: 20_000 })
      .toContain("[phase2-stub] got SIGTERM");
  } finally {
    await closeSpawnedApp(app);
    void browser?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a remote debugging port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForDevToolsWsEndpoint(app: ChildProcess): Promise<string> {
  const stderr = app.stderr;
  if (!stderr) {
    throw new Error("Spawned Electron process did not expose stderr for DevTools detection.");
  }

  return await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const endpointPattern = /DevTools listening on (ws:\/\/[^\s]+)/;

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const match = buffer.match(endpointPattern);
      if (match?.[1]) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`Electron exited before exposing a DevTools endpoint.\n${buffer}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      stderr.off("data", onData);
      app.off("exit", onExit);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for a DevTools endpoint.\n${buffer}`));
    }, 20_000);

    stderr.on("data", onData);
    app.once("exit", onExit);
  });
}

async function connectToPackagedApp(endpoint: string): Promise<Browser> {
  let browser: Browser | null = null;
  await expect
    .poll(
      async () => {
        try {
          browser = await chromium.connectOverCDP(endpoint);
          return true;
        } catch {
          return false;
        }
      },
      {
        timeout: 20_000,
      }
    )
    .toBe(true);

  if (!browser) throw new Error("Failed to connect to packaged app.");
  return browser;
}

async function firstAppPage(browser: Browser): Promise<Page> {
  await expect
    .poll(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .filter((page) => !page.isClosed()).length,
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);

  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => !page.isClosed());
  if (!page) throw new Error("No app page found.");
  return page;
}

async function terminalText(page: Page): Promise<string> {
  return await page.locator("body").innerText();
}

async function closeSpawnedApp(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null || app.killed) return;
  app.kill("SIGTERM");
  if (await waitForProcessExit(app, 3_000)) return;
  if (app.exitCode === null) {
    app.kill("SIGKILL");
  }
  await waitForProcessExit(app, 3_000);
}

async function waitForProcessExit(app: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (app.exitCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(app.exitCode !== null);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      app.off("exit", onExit);
    };
    app.once("exit", onExit);
  });
}

function findPackagedAppEntry(): string | null {
  const outDir = join(process.cwd(), "out");
  const arch = process.arch;

  const candidates =
    process.platform === "darwin"
      ? [
          join(
            outDir,
            `AgentProfile-darwin-${arch}`,
            "AgentProfile.app",
            "Contents",
            "Resources",
            "app.asar"
          ),
          join(
            outDir,
            "AgentProfile-darwin-arm64",
            "AgentProfile.app",
            "Contents",
            "Resources",
            "app.asar"
          ),
          join(
            outDir,
            "AgentProfile-darwin-x64",
            "AgentProfile.app",
            "Contents",
            "Resources",
            "app.asar"
          ),
        ]
      : [
          join(outDir, `AgentProfile-linux-${arch}`, "resources", "app.asar"),
          join(outDir, "AgentProfile-linux-arm64", "resources", "app.asar"),
          join(outDir, "AgentProfile-linux-x64", "resources", "app.asar"),
        ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function seedProfileFiles(input: {
  homeDir: string;
  myClaudeHome: string;
  projectDir: string;
}): Promise<void> {
  await writeFile(join(input.myClaudeHome, ".setup-complete"), `${new Date().toISOString()}\n`);
  await writeFile(
    join(input.myClaudeHome, "config", "authProfiles.yml"),
    `
version: 1
authProfiles:
  work:
    displayName: Work
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs: {}
`.trimStart()
  );
  await writeFile(
    join(input.myClaudeHome, "config", "global", "shared.yml"),
    `
version: 1
settings:
  theme: dark
env:
  GLOBAL_SHARED_FLAG: enabled
`.trimStart()
  );
  await writeFile(
    join(input.myClaudeHome, "config", "global", "roles", "backend.yml"),
    `
version: 1
env:
  GLOBAL_ROLE_FLAG: backend
`.trimStart()
  );
  await writeFile(
    join(input.projectDir, ".myclaude", "shared.yml"),
    `
version: 1
env:
  PROJECT_SHARED_FLAG: enabled
`.trimStart()
  );
  await writeFile(
    join(input.projectDir, ".myclaude", "roles", "backend.yml"),
    `
version: 1
env:
  PROJECT_ROLE_FLAG: backend
`.trimStart()
  );
  await writeFile(join(input.homeDir, ".zshrc"), "# e2e sandbox\n");
}

async function writeClaudeStub(stubPath: string): Promise<void> {
  await writeFile(
    stubPath,
    [
      "#!/bin/sh",
      "set -eu",
      "",
      "on_term() {",
      "  printf '%s\\n' '[phase2-stub] got SIGTERM'",
      "  exit 0",
      "}",
      "",
      "trap 'on_term' TERM INT HUP",
      "",
      "printf '%s\\n' '[phase2-stub] boot'",
      "printf '[phase2-stub] session %s\\n' \"${MYCLAUDE_SESSION_ID:-missing}\"",
      "printf '[phase2-stub] cwd %s\\n' \"$PWD\"",
      "printf '[phase2-stub] args %s\\n' \"$*\"",
      "printf '%s\\n' '[phase2-stub] ready'",
      "",
      "i=0",
      'while [ "$i" -lt 120 ]; do',
      "  i=$((i + 1))",
      "  sleep 1",
      "done",
      "",
      "printf '%s\\n' '[phase2-stub] natural exit'",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  chmodSync(stubPath, 0o755);
}

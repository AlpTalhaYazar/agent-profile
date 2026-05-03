import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type Page, chromium, expect, test } from "@playwright/test";
import electronExecutable from "electron";

const electronExecutablePath = electronExecutable as unknown as string;

test("packaged Claude Auth add + rotate never writes plaintext secrets to authProfiles.yml", async () => {
  const packagedAppEntry = findPackagedAppEntry();
  expect(
    packagedAppEntry,
    `missing packaged desktop app.asar under ${join(process.cwd(), "out")}; run pnpm --filter @agent-profile/desktop package first`
  ).toBeTruthy();
  expect(
    existsSync(electronExecutablePath),
    `missing Electron executable at ${electronExecutablePath}`
  ).toBe(true);

  const root = await mkdtemp(join(tmpdir(), "ap-p2-auth-"));
  const homeDir = join(root, "home");
  const myClaudeHome = join(homeDir, ".myclaude");
  const projectDir = join(root, "project");
  const socketPath = join(root, "mc.sock");
  const electronUserDataDir = join(root, "electron-user-data");
  const authProfilesPath = join(myClaudeHome, "config", "authProfiles.yml");
  const profileId = "phase2-work";
  const displayName = "Phase2 Work";
  const addedKey = "fake-phase2-added-key";
  const rotatedKey = "fake-phase2-rotated-key";
  const secretRef = `keyring://anthropic/${profileId}`;
  const remoteDebuggingPort = await getAvailablePort();
  let app: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    await seedFixture({ authProfilesPath, homeDir, myClaudeHome, projectDir });

    const launchEnv = { ...process.env };
    launchEnv.ELECTRON_RUN_AS_NODE = undefined;
    const appArgs = [
      "--inspect=0",
      `--remote-debugging-port=${remoteDebuggingPort}`,
      `--user-data-dir=${electronUserDataDir}`,
      packagedAppEntry as string,
    ];
    app = spawn(electronExecutablePath, appArgs, {
      cwd: projectDir,
      env: {
        ...launchEnv,
        HOME: homeDir,
        MYCLAUDE_ALLOW_PLAINTEXT: "1",
        MYCLAUDE_E2E_PLAINTEXT_SECRETS: "1",
        MYCLAUDE_HOME: myClaudeHome,
        MYCLAUDE_SOCKET: socketPath,
        PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
      },
      stdio: "pipe",
    });

    const devToolsWsEndpoint = await waitForDevToolsWsEndpoint(app);
    browser = await connectToPackagedApp(devToolsWsEndpoint);
    const page = await firstAppPage(browser);
    await page.bringToFront();

    await expect(page.getByRole("heading", { name: "Profile Workspace" })).toBeVisible();
    await page.getByTestId("sidebar-auth-vault").click();
    await expect(page.getByRole("heading", { name: "Claude credentials" })).toBeVisible();
    await expect(page.getByText("0 configured")).toBeVisible();

    await page.getByRole("button", { name: "Connect Claude", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Connect Claude credential" })).toBeVisible();
    await page.getByLabel("Display name").fill(displayName);
    await page.getByLabel("Claude secret ref").fill(secretRef);

    const secretPagePromise = waitForPageWithHeading(
      browser,
      `Add Claude credential "${profileId}"`
    );
    await page.getByRole("button", { name: /Continue/ }).click();
    const secretPage = await secretPagePromise;
    await secretPage.getByLabel("Anthropic API key").fill(addedKey);
    await secretPage.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => readFile(authProfilesPath, "utf8"), { timeout: 15_000 })
      .toContain(`${profileId}:`);
    await expect
      .poll(async () => readFile(authProfilesPath, "utf8"), { timeout: 15_000 })
      .toContain(secretRef);

    const profileButton = page.getByRole("button", {
      name: new RegExp(`${profileId}\\s+${displayName}`),
    });
    await expect(profileButton).toBeVisible({
      timeout: 15_000,
    });
    await profileButton.click();
    await expect(page.getByRole("button", { name: "Rotate Claude key" })).toBeVisible();

    await page.getByRole("button", { name: "Rotate Claude key" }).click();
    await expect(
      page.getByRole("heading", { name: `Rotate Claude key for "${profileId}"` })
    ).toBeVisible();
    const rotateDialog = page.getByRole("dialog", {
      name: `Rotate Claude key for "${profileId}"`,
    });
    await rotateDialog.getByRole("textbox").fill(rotatedKey);
    await expect(rotateDialog.getByRole("button", { name: "Rotate" })).toBeEnabled();
    await rotateDialog.getByRole("button", { name: "Rotate" }).click();
    await expect(
      page.getByRole("heading", { name: `Rotate Claude key for "${profileId}"` })
    ).toBeHidden({ timeout: 15_000 });

    const finalAuthProfiles = await readFile(authProfilesPath, "utf8");
    expect(finalAuthProfiles).toContain(`${profileId}:`);
    expect(finalAuthProfiles).toContain("displayName: Phase2 Work");
    expect(finalAuthProfiles).toContain(secretRef);
    expect(finalAuthProfiles).not.toContain(addedKey);
    expect(finalAuthProfiles).not.toContain(rotatedKey);
  } finally {
    await browser?.close().catch(() => undefined);
    if (app) await closeSpawnedApp(app);
    await rm(root, { recursive: true, force: true });
  }
});

async function seedFixture(input: {
  authProfilesPath: string;
  homeDir: string;
  myClaudeHome: string;
  projectDir: string;
}): Promise<void> {
  await mkdir(join(input.myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(input.projectDir, ".myclaude", "roles"), { recursive: true });
  await writeFile(join(input.myClaudeHome, ".setup-complete"), `${new Date().toISOString()}\n`);
  await writeFile(
    input.authProfilesPath,
    `
version: 1
authProfiles: {}
`.trimStart()
  );
  await writeFile(
    join(input.myClaudeHome, "config", "global", "shared.yml"),
    `
version: 1
env:
  EDITOR: nvim
`.trimStart()
  );
  await writeFile(
    join(input.myClaudeHome, "config", "global", "roles", "backend.yml"),
    "version: 1\n"
  );
  await writeFile(join(input.projectDir, ".myclaude", "shared.yml"), "version: 1\n");
  await writeFile(join(input.projectDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");
  await writeFile(join(input.homeDir, ".zshrc"), "# auth write e2e sandbox\n");
}

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
      { timeout: 20_000 }
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

async function waitForPageWithHeading(browser: Browser, heading: string): Promise<Page> {
  let matched: Page | null = null;
  await expect
    .poll(
      async () => {
        for (const page of browser.contexts().flatMap((context) => context.pages())) {
          if (page.isClosed()) continue;
          const visible = await page
            .getByRole("heading", { name: heading })
            .isVisible()
            .catch(() => false);
          if (visible) {
            matched = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  if (!matched) throw new Error(`No page found with heading "${heading}".`);
  return matched;
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
